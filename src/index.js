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

async function scanSingleSymbol(symbol) {
    console.log(`\nĐang kiểm tra ${symbol}...\n`);

    const [currentPrice, klines] = await Promise.all([
        getSpotPrice(symbol),
        getSpotKlines(symbol, "5m", 100)
    ]);

    const result = analyzeKlines(klines, {
        symbol,
        interval: "5m",
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

async function main() {
    const arg = process.argv[2];

    if (arg?.toLowerCase() === "--all") {
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