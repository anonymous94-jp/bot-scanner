
const logger = require("./logger");

function parseRetryAfter(value) {
    if (value == null) return null;

    const raw = String(value).trim();

    // Binance thường trả số giây; cũng hỗ trợ dạng HTTP date.
    const seconds = Number(raw);

    if (raw !== "" && Number.isFinite(seconds) && seconds >= 0) {
        return Date.now() + seconds * 1000;
    }

    const date = Date.parse(raw);

    return Number.isFinite(date) ? date : null;
}

function createRateLimitCoordinator() {
    let blockedUntil = 0;
    let blockedStatus = null;
    let waitPromise = null;
    let stopped = false;

    function getRetryUntil(error) {
        const header = error?.retryAfter ??
            error?.headers?.["retry-after"] ??
            error?.headers?.["Retry-After"];

        const fromHeader = parseRetryAfter(header);

        if (fromHeader !== null) {
            return fromHeader;
        }

        // Không tự đoán thời gian hết hạn cho HTTP 418.
        if (error?.status === 418) {
            return null;
        }

        // Fallback thận trọng nếu 429 không có Retry-After.
        if (error?.status === 429) {
            return Date.now() + 60_000;
        }

        return null;
    }

    function block(error) {
        const status = error?.status;

        if (status !== 418 && status !== 429) {
            return;
        }

        const retryUntil = getRetryUntil(error);

        if (retryUntil === null) {
            stopped = true;
            blockedStatus = status;

            logger.rateLimit(
                "Tạm dừng scanner vì Binance trả lỗi giới hạn không có thời gian mở lại rõ ràng",
                {
                    status,
                    symbol: error.symbol ?? null,
                    endpoint: error.endpoint ?? null,
                    action: "manual_restart_required"
                }
            );

            return;
        }

        // Chỉ kéo dài thời gian chặn, không rút ngắn chặn đang có.
        if (retryUntil > blockedUntil) {
            blockedUntil = retryUntil;
            blockedStatus = status;
        }

        logger.rateLimit("Đã tạm dừng request toàn cục", {
            status,
            symbol: error.symbol ?? null,
            endpoint: error.endpoint ?? null,
            blockedUntil: new Date(blockedUntil).toISOString(),
            waitMs: Math.max(0, blockedUntil - Date.now())
        });
    }

    async function waitUntilAllowed() {
        while (true) {
            if (stopped) {
                throw new Error(
                    `Scanner đang dừng do HTTP ${blockedStatus}; cần kiểm tra tình trạng Binance trước khi chạy lại`
                );
            }

            const remaining = blockedUntil - Date.now();

            if (remaining <= 0) {
                return;
            }

            if (!waitPromise) {
                waitPromise = (async () => {
                    logger.warn("Worker đang chờ rate limit toàn cục", {
                        blockedStatus,
                        waitMs: Math.max(0, blockedUntil - Date.now())
                    });

                    await new Promise(resolve =>
                        setTimeout(
                            resolve,
                            Math.min(blockedUntil - Date.now(), 1000)
                        )
                    );
                })().finally(() => {
                    waitPromise = null;
                });
            }

            await waitPromise;
        }
    }

    return {
        block,
        waitUntilAllowed,
        isStopped: () => stopped,
        getBlockedUntil: () => blockedUntil
    };
}

module.exports = {
    createRateLimitCoordinator
};
