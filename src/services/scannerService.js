
const {
    getSpotUsdtSymbols,
    getSpotKlines
} = require("./binanceService");

const { analyzeKlines } = require("./indicatorService");
const logger = require("./logger");
const { createRateLimitCoordinator } = require("./rateLimitCoordinator");

const VOL_RATIO_THRESHOLD = 2;
const CONCURRENCY = 5;
const KLINE_LIMIT = 100;
const MAX_RETRIES = 3;
const REQUEST_GAP_MS = 100;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
    const status = error.status;

    return status === 418 ||
        status === 429 ||
        (Number.isInteger(status) && status >= 500 && status <= 599) ||
        /timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i
            .test(`${error.code || ""} ${error.message || ""}`);
}

/**
 * Mọi request trong lượt quét phải đi qua hàm này.
 * Rate limit được điều phối chung cho tất cả worker.
 */

async function requestWithRetry(
    operation,
    { coordinator, description, symbol = null }
) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        await coordinator.waitUntilAllowed();

        try {
            return await operation();
        } catch (error) {
            const retryable = isRetryableError(error);
            const isRateLimit =
                error.status === 418 || error.status === 429;

            // Luôn báo coordinator trước khi quyết định dừng retry,
            // kể cả khi đây là lần thử cuối cùng.
            if (isRateLimit) {
                coordinator.block(error);

                if (coordinator.isStopped()) {
                    throw error;
                }
            }

            if (!retryable || attempt >= MAX_RETRIES) {
                throw error;
            }

            if (isRateLimit) {
                logger.warn("Request sẽ thử lại sau khi rate limit được xử lý", {
                    description,
                    symbol,
                    status: error.status,
                    attempt: attempt + 1,
                    maxRetries: MAX_RETRIES,
                    retryAfter: error.retryAfter ?? null
                });

                // Vòng lặp kế tiếp sẽ chờ coordinator.
                continue;
            }

            const delay = Math.min(
                2000 * (2 ** attempt),
                30000
            );

            logger.warn("Request gặp lỗi tạm thời, sẽ thử lại", {
                description,
                symbol,
                status: error.status ?? null,
                code: error.code ?? null,
                attempt: attempt + 1,
                maxRetries: MAX_RETRIES,
                delayMs: delay,
                message: error.message
            });

            await sleep(delay);
        }
    }

    throw new Error(`Đã hết số lần thử: ${description}`);
}


async function scanOneSymbol(symbol, options = {}) {
    const coordinator = options.coordinator ||
        createRateLimitCoordinator();

    const klines = await requestWithRetry(
        () => getSpotKlines(symbol, "15m", KLINE_LIMIT),
        {
            coordinator,
            description: "Lấy nến Spot",
            symbol
        }
    );

    return analyzeKlines(klines, {
        symbol,
        interval: "15m"
    });
}

async function scanAllSpotUsdt(options = {}) {
    const threshold = options.threshold ?? VOL_RATIO_THRESHOLD;
    const concurrency = options.concurrency ?? CONCURRENCY;

    if (!Number.isFinite(threshold) || threshold < 0) {
        throw new Error("threshold phải là số không âm");
    }

    if (!Number.isInteger(concurrency) ||
        concurrency < 1 ||
        concurrency > 10) {
        throw new Error("concurrency phải là số nguyên từ 1 đến 10");
    }

    const coordinator = createRateLimitCoordinator();
    const startedAt = Date.now();

    logger.info("Bắt đầu lượt quét Binance Spot USDT", {
        threshold,
        concurrency,
        klineLimit: KLINE_LIMIT,
        interval: "5m"
    });

    let symbols;

    try {
        // Request lấy danh sách symbol cũng phải tuân theo rate limit.
        symbols = await requestWithRetry(
            () => getSpotUsdtSymbols(),
            {
                coordinator,
                description: "Lấy danh sách Spot USDT"
            }
        );
    } catch (error) {
        logger.error("Không thể lấy danh sách Spot USDT", {
            message: error.message,
            status: error.status ?? null,
            code: error.code ?? null,
            endpoint: error.endpoint ?? null
        });

        throw error;
    }

    logger.info("Đã lấy danh sách Spot USDT", {
        totalSymbols: symbols.length,
        threshold,
        concurrency
    });

    const matches = [];
    const errors = [];

    let nextIndex = 0;
    let completed = 0;

    async function worker() {
        while (true) {
            try {
                // Bảo đảm worker không lấy công việc mới
                // khi đang có lệnh tạm dừng toàn cục.
                await coordinator.waitUntilAllowed();
            } catch (error) {
                if (coordinator.isStopped()) {
                    return;
                }

                throw error;
            }

            const index = nextIndex++;

            if (index >= symbols.length) {
                return;
            }

            const symbol = symbols[index];

            try {
                const result = await scanOneSymbol(symbol, {
                    coordinator
                });

                if (
                    Number.isFinite(result.volRatio) &&
                    result.volRatio >= threshold
                ) {
                    matches.push(result);

                    logger.info("Symbol đạt điều kiện VolRatio", {
                        symbol,
                        volRatio: result.volRatio,
                        threshold,
                        rsi14: result.rsi14,
                        change15mPct: result.change15mPct
                    });
                }
            } catch (error) {
                errors.push({
                    symbol,
                    status: error.status ?? null,
                    code: error.code ?? null,
                    message: error.message
                });

                logger.error("Phân tích symbol thất bại", {
                    symbol,
                    status: error.status ?? null,
                    code: error.code ?? null,
                    endpoint: error.endpoint ?? null,
                    message: error.message
                });

                // Không tiếp tục nhận công việc mới nếu scanner
                // đã bị dừng an toàn do HTTP 418 không có Retry-After.
                if (coordinator.isStopped()) {
                    return;
                }
            }

            completed++;

            if (
                completed % 50 === 0 ||
                completed === symbols.length
            ) {
                logger.info("Tiến độ quét", {
                    completed,
                    total: symbols.length,
                    matches: matches.length,
                    errors: errors.length
                });
            }

            await sleep(REQUEST_GAP_MS);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, symbols.length) },
            () => worker()
        )
    );

    matches.sort((a, b) => b.volRatio - a.volRatio);

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const stopped = coordinator.isStopped();

    logger.info("Kết thúc lượt quét", {
        totalSymbols: symbols.length,
        completed,
        matches: matches.length,
        errors: errors.length,
        elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
        stoppedByRateLimit: stopped
    });

    console.log("\n========== SCAN SUMMARY ==========");
    console.log(`Tổng số cặp:       ${symbols.length}`);
    console.log(`Đã xử lý:          ${completed}`);
    console.log(`Đạt VolRatio:      ${matches.length}`);
    console.log(`Lỗi:               ${errors.length}`);
    console.log(`Thời gian:         ${elapsedSeconds.toFixed(1)} giây`);
    console.log(`Dừng do rate limit: ${stopped ? "CÓ" : "KHÔNG"}`);

    if (matches.length > 0) {
        console.log("\n========== MATCHES ==========");

        console.table(
            matches.map(item => ({
                Symbol: item.symbol,
                CurrentPrice: item.currentPrice ?? item.closePrice,
                VolRatio: `${item.volRatio.toFixed(2)}x`,
                RSI14: item.rsi14?.toFixed(2),
                EMA20: item.ema20?.toFixed(8),
                EMA50: item.ema50?.toFixed(8),
                DistanceEMA20: item.priceVsEma20Pct == null
                    ? "N/A"
                    : `${item.priceVsEma20Pct.toFixed(3)}%`,
                DistanceEMA50: item.priceVsEma50Pct == null
                    ? "N/A"
                    : `${item.priceVsEma50Pct.toFixed(3)}%`,
                Change15m: item.change15mPct == null
                    ? "N/A"
                    : `${item.change15mPct.toFixed(3)}%`
            }))
        );
    } else {
        console.log("Không có cặp nào đạt điều kiện.");
    }

    if (errors.length > 0) {
        console.log("\n========== SCAN ERRORS ==========");
        console.table(errors.slice(0, 20));

        if (errors.length > 20) {
            console.log(`Còn ${errors.length - 20} lỗi không hiển thị.`);
        }
    }

    return {
        symbols,
        matches,
        errors,
        elapsedSeconds,
        stoppedByRateLimit: stopped
    };
}

module.exports = {
    scanOneSymbol,
    scanAllSpotUsdt
};
