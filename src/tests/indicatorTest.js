
const assert = require("node:assert/strict");

const {
    calculateEMA,
    calculateRSI,
    analyzeKlines
} = require("../services/indicatorService");

// Test EMA: EMA của 3 giá trị [1, 2, 3] = SMA = 2.
assert.equal(calculateEMA([1, 2, 3], 3), 2);

// Test RSI: giá tăng liên tục => RSI = 100.
assert.equal(calculateRSI(
    Array.from({ length: 16 }, (_, i) => 100 + i),
    14
), 100);

// Test RSI: giá giảm liên tục => RSI = 0.
assert.equal(calculateRSI(
    Array.from({ length: 16 }, (_, i) => 200 - i),
    14
), 0);

// Tạo 61 nến giả lập, mỗi nến cách nhau 5 phút.
const now = Date.now();

const candles = Array.from({ length: 61 }, (_, i) => {
    const openTime = now - (61 - i) * 5 * 60 * 1000;

    return {
        openTime,
        closeTime: openTime + 5 * 60 * 1000 - 1,
        open: 100 + i,
        high: 101 + i,
        low: 99 + i,
        close: 100 + i,
        volume: 100,
        quoteVolume: i === 60 ? 300 : 100
    };
});

const result = analyzeKlines(candles, {
    symbol: "TESTUSDT",
    interval: "5m",
    currentPrice: 160,
    now
});

// Nến cuối có quote volume 300.
// Trung bình 20 nến trước là 100 => VolRatio = 3.
assert.equal(result.volRatio, 3);
assert.equal(result.rsi14, 100);
assert.ok(result.ema20 !== null);
assert.ok(result.ema50 !== null);
assert.equal(result.trend, "bullish");
assert.ok(
    Math.abs(result.change15mPct - ((160 / 157 - 1) * 100)) < 1e-9,
    "change15mPct không khớp với giá trị kỳ vọng"
);

console.log("All indicator tests passed!");
console.log(result);
