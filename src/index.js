
require("dotenv").config();

const {
    getSpotPrice,
    getSpotKlines,
    getFuturesPairInfo,
    getFuturesPrice
} = require("./services/binanceService");

const {
    analyzeKlines
} = require("./services/indicatorService");

const {
    scanAllSpotUsdt
} = require("./services/scannerService");

const {
    sendMessage,
    sendScanResults
} = require("./services/telegramService");

async function scanSingleSymbol(symbol) {
    console.log(`\nĐang kiểm tra ${symbol}...\n`);

    const [currentPrice, klines] = await Promise.all([
        getSpotPrice(symbol),
        getSpotKlines(symbol, "15m", 100)
    ]);

    const result = analyzeKlines(klines, {
        symbol,
        interval: "15m",
        currentPrice
    });

    console.log("========== SPOT ANALYSIS ==========");
    console.log(`Symbol:         ${result.symbol}`);
    console.log(`Current price:  ${result.currentPrice}`);
    console.log(`Last close:     ${result.closePrice}`);
    console.log(`VolRatio:       ${result.volRatio?.toFixed(2)}x`);
    console.log(`RSI(14):        ${result.rsi14?.toFixed(2)}`);
    console.log(`EMA20:          ${result.ema20?.toFixed(8)}`);
    console.log(`Distance EMA20: ${result.priceVsEma20Pct?.toFixed(3)}%`);
    console.log(`EMA50:          ${result.ema50?.toFixed(8)}`);
    console.log(`Distance EMA50: ${result.priceVsEma50Pct?.toFixed(3)}%`);
    console.log(`Change 15m:     ${result.change15mPct?.toFixed(2)}%`);
    console.log(`Price vs EMA20: ${result.priceVsEma20}`);
    console.log(`EMA trend:      ${result.trend}`);

    console.log("\n========== FUTURES CHECK ==========");

    const futures = await getFuturesPairInfo(symbol);

    if (!futures.available) {
        console.log("Futures USDT-M: Không có cặp tương ứng.");
    } else {
        const futuresPrice = await getFuturesPrice(symbol);
        console.log(`Futures pair:   ${futures.symbol}`);
        console.log(`Futures price:  ${futuresPrice}`);
    }
}

// Tính thời gian đến mốc 15 phút tiếp theo + 5 giây.
function msUntilNextQuarterHour() {
    const now = new Date();
    const next = new Date(now);

    next.setMilliseconds(0);

    const nextMinute = (Math.floor(now.getMinutes() / 15) + 1) * 15;

    if (nextMinute >= 60) {
        next.setHours(now.getHours() + 1, 0, 5, 0);
    } else {
        next.setMinutes(nextMinute, 5, 0);
    }

    return Math.max(0, next.getTime() - now.getTime());
}

async function runScheduledScan() {
    console.log("\n========================================");
    console.log("BẮT ĐẦU QUÉT BINANCE SPOT USDT");
    console.log(`Thời gian: ${new Date().toLocaleString("ja-JP")}`);
    console.log("========================================\n");

    try {
        const result = await scanAllSpotUsdt({
            threshold: 2,
            concurrency: 5
        });

        await sendScanResults(result);

        console.log("\nĐã gửi kết quả lượt quét lên Telegram.");

        if (result.stoppedByRateLimit) {
            console.error(
                "Scanner đã dừng do rate limit. Không lên lịch quét tiếp; cần kiểm tra và khởi động lại thủ công."
            );

            return false;
        }

        return true;
    } catch (error) {
        console.error("Lượt quét thất bại:", error.message);

        // Thông báo lỗi qua Telegram nếu kết nối Telegram vẫn hoạt động.
        try {
            await sendMessage(
                [
                    "⚠️ <b>BINANCE SCANNER ERROR</b>",
                    `Thời gian: ${new Date().toLocaleString("ja-JP", {
                        timeZone: "Asia/Tokyo"
                    })}`,
                    `Lỗi: ${String(error.message).slice(0, 2500)}`
                ].join("\n")
            );
        } catch (telegramError) {
            console.error(
                "Không gửi được thông báo lỗi Telegram:",
                telegramError.message
            );
        }

        // Lỗi thông thường sẽ được thử lại ở lịch quét kế tiếp.
        // Nếu scanner trả về stoppedByRateLimit=true, chương trình dừng hẳn.
        return true;
    }
}

async function startWatchMode() {
    console.log("\nChế độ: TỰ ĐỘNG QUÉT MỖI 15 PHÚT");
    console.log("Ngưỡng VolRatio: >= 2.0x");
    console.log("Số worker: 5");
    console.log("Telegram: đang kiểm tra kết nối...\n");

    // Gửi tin nhắn khởi động để xác nhận cấu hình Telegram hoạt động.
    await sendMessage(
        [
            "✅ <b>BINANCE SPOT SCANNER ĐÃ KHỞI ĐỘNG</b>",
            "Chu kỳ: 15 phút",
            "Khung nến: 15m",
            "Điều kiện: VolRatio ≥ 2.0x",
            "Lượt quét đầu tiên sẽ bắt đầu ngay."
        ].join("\n")
    );

    async function runAndSchedule() {
        const shouldContinue = await runScheduledScan();

        if (!shouldContinue) {
            console.error("Đã dừng lịch quét tự động.");
            return;
        }

        const delay = msUntilNextQuarterHour();
        const nextRun = new Date(Date.now() + delay);

        console.log(
            `\nLượt quét tiếp theo: ${nextRun.toLocaleString("ja-JP")}`
        );

        setTimeout(runAndSchedule, delay);
    }

    await runAndSchedule();
}

async function main() {
    const arg = (process.argv[2] || "").toLowerCase();

    if (arg === "--watch") {
        await startWatchMode();
        return;
    }

    if (arg === "--all") {
        console.log("\nChế độ: QUÉT TOÀN BỘ BINANCE SPOT USDT\n");

        await scanAllSpotUsdt({
            threshold: 2,
            concurrency: 5
        });

        return;
    }

    const symbol = (arg || "SOLUSDT").toUpperCase();
    await scanSingleSymbol(symbol);
}

main().catch(error => {
    console.error("\nChương trình thất bại:", error.message);
    process.exitCode = 1;
});
