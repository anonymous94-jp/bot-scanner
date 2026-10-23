
const {
    getSpotUsdtSymbols,
    getSpotKlines
} = require("./binanceService");

const { analyzeKlines } = require("./indicatorService");

const VOL_RATIO_THRESHOLD = 2;
const CONCURRENCY = 5;
const KLINE_LIMIT = 100;
const MAX_RETRIES = 3;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
    const message = error.message || "";

    return /HTTP (418|429|5\d\d)/.test(message) ||
        /timeout|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

async function getKlinesWithRetry(symbol) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await getSpotKlines(symbol, "5m", KLINE_LIMIT);
        } catch (error) {
            if (
                attempt === MAX_RETRIES ||
                !isRetryableError(error)
            ) {
                throw error;
            }

            const message = error.message || "";

            // Binance 418: IP có thể đang bị hạn chế.
            // Tạm dừng lâu hơn thay vì tiếp tục gửi request dồn dập.
            const delay = /HTTP 418/.test(message)
                ? 60_000
                : /HTTP 429/.test(message)
                    ? 10_000 * (attempt + 1)
                    : 2_000 * (2 ** attempt);

            console.warn(
                `[RETRY] ${symbol}: ${message}. ` +
                `Thử lại sau ${delay / 1000}s ` +
                `(${attempt + 1}/${MAX_RETRIES})`
            );

            await sleep(delay);
        }
    }

    throw new Error(`Không lấy được dữ liệu ${symbol}`);
}

async function scanOneSymbol(symbol) {
    const klines = await getKlinesWithRetry(symbol);

    const analysis = analyzeKlines(klines, {
        symbol,
        interval: "5m"
    });

    return analysis;
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

    console.log("Đang lấy danh sách Binance Spot USDT...");

    const symbols = await getSpotUsdtSymbols();

    console.log(`Tìm thấy ${symbols.length} cặp Spot USDT.`);
    console.log(`Concurrency: ${concurrency}`);
    console.log(`Điều kiện VolRatio >= ${threshold}x`);
    console.log("Bắt đầu quét...\n");

    const matches = [];
    const errors = [];

    let nextIndex = 0;
    let completed = 0;

    async function worker() {
        while (true) {
            const index = nextIndex++;

            if (index >= symbols.length) {
                return;
            }

            const symbol = symbols[index];

            try {
                const result = await scanOneSymbol(symbol);

                if (
                    Number.isFinite(result.volRatio) &&
                    result.volRatio >= threshold
                ) {
                    matches.push(result);
                }
            } catch (error) {
                errors.push({
                    symbol,
                    message: error.message
                });
            }

            completed++;

            if (
                completed % 50 === 0 ||
                completed === symbols.length
            ) {
                console.log(
                    `Tiến độ: ${completed}/${symbols.length} | ` +
                    `Đạt điều kiện: ${matches.length} | ` +
                    `Lỗi: ${errors.length}`
                );
            }

            // Giãn nhẹ giữa các request của từng worker.
            await sleep(100);
        }
    }

    const startedAt = Date.now();

    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, symbols.length) },
            () => worker()
        )
    );

    matches.sort((a, b) => b.volRatio - a.volRatio);

    const elapsedSeconds = (Date.now() - startedAt) / 1000;

    console.log("\n========== SCAN SUMMARY ==========");
    console.log(`Tổng số cặp:       ${symbols.length}`);
    console.log(`Đã xử lý:          ${completed}`);
    console.log(`Đạt VolRatio:      ${matches.length}`);
    console.log(`Lỗi:               ${errors.length}`);
    console.log(`Thời gian:         ${elapsedSeconds.toFixed(1)} giây`);

    if (matches.length > 0) {
        console.log("\n========== MATCHES ==========");

        console.table(
            matches.map(item => ({
                Symbol: item.symbol,
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
            console.log(
                `Còn ${errors.length - 20} lỗi không hiển thị.`
            );
        }
    }

    return { symbols, matches, errors, elapsedSeconds };
}

module.exports = {
    scanOneSymbol,
    scanAllSpotUsdt
};
