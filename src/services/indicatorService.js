
const MIN_CANDLES = 60;
const VOL_LOOKBACK = 20;
const RSI_PERIOD = 14;

function calculateEMA(values, period) {
    if (values.length < period) {
        return null;
    }

    const multiplier = 2 / (period + 1);

    let ema = values
        .slice(0, period)
        .reduce((sum, value) => sum + value, 0) / period;

    for (let i = period; i < values.length; i++) {
        ema = values[i] * multiplier + ema * (1 - multiplier);
    }

    return ema;
}

function calculateRSI(values, period = RSI_PERIOD) {
    if (values.length < period + 1) {
        return null;
    }

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
        const change = values[i] - values[i - 1];

        if (change > 0) {
            gains += change;
        } else {
            losses -= change;
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < values.length; i++) {
        const change = values[i] - values[i - 1];
        const gain = Math.max(change, 0);
        const loss = Math.max(-change, 0);

        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgLoss === 0) {
        return avgGain === 0 ? 50 : 100;
    }

    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}

/**
 * Chỉ giữ nến đã đóng.
 * Dùng closeTime < now để tránh lấy nến đang hình thành.
 */
function getClosedCandles(klines, now = Date.now()) {
    return klines
        .filter(kline =>
            Number.isFinite(kline.close) &&
            Number.isFinite(kline.quoteVolume) &&
            kline.closeTime < now
        )
        .sort((a, b) => a.openTime - b.openTime);
}

function analyzeKlines(klines, options = {}) {
    const now = options.now ?? Date.now();
    const candles = getClosedCandles(klines, now);

    if (candles.length < MIN_CANDLES) {
        throw new Error(
            `Không đủ nến đã đóng: cần ít nhất ${MIN_CANDLES}, ` +
            `hiện có ${candles.length}`
        );
    }

    const closes = candles.map(candle => candle.close);
    const last = candles[candles.length - 1];

    // VolRatio: nến mới nhất so với 20 nến đứng trước nó.
    const previousCandles = candles.slice(
        -(VOL_LOOKBACK + 1),
        -1
    );

    const avgQuoteVolume =
        previousCandles.reduce(
            (sum, candle) => sum + candle.quoteVolume,
            0
        ) / VOL_LOOKBACK;

    const volRatio = avgQuoteVolume > 0
        ? last.quoteVolume / avgQuoteVolume
        : null;

    // Giá đóng cửa hiện tại so với giá đóng cửa cách 15 phút.
    // Với nến 5m: so sánh nến cuối và nến cách 3 vị trí.
    // const reference = candles[candles.length - 4];

    // const change15mPct = reference && reference.close !== 0
    //     ? ((last.close - reference.close) / reference.close) * 100
    //     : null;
    // Với nến 15m: so sánh nến cuối và nến cách 1 vị trí.
    const reference = candles[candles.length - 2];

    const change15mPct = reference && reference.close !== 0
        ? ((last.close - reference.close) / reference.close) * 100
        : null;

    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const rsi14 = calculateRSI(closes, RSI_PERIOD);

    const priceVsEma20Pct = ema20 !== null && ema20 !== 0
        ? ((last.close - ema20) / ema20) * 100
        : null;

    const priceVsEma50Pct = ema50 !== null && ema50 !== 0
        ? ((last.close - ema50) / ema50) * 100
        : null;

    return {
        symbol: options.symbol ?? null,
        interval: options.interval ?? "15m",
        candleCloseTime: last.closeTime,
        closePrice: last.close,
        currentPrice: options.currentPrice ?? null,
        volRatio,
        lastQuoteVolume: last.quoteVolume,
        avgQuoteVolume20: avgQuoteVolume,
        rsi14,
        ema20,
        ema50,
        change15mPct,
        priceVsEma20: last.close > ema20 ? "above" :
            last.close < ema20 ? "below" : "equal",
        trend: ema20 > ema50 ? "bullish" :
            ema20 < ema50 ? "bearish" : "neutral",
        priceVsEma20Pct,
        priceVsEma50Pct,
    };
}

module.exports = {
    calculateEMA,
    calculateRSI,
    getClosedCandles,
    analyzeKlines
};
