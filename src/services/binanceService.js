
const axios = require("axios");

const SPOT_BASE_URL = "https://api.binance.com";
const FUTURES_BASE_URL = "https://fapi.binance.com";

const http = axios.create({
    timeout: 15000,
    headers: {
        "User-Agent": "binance-volratio-scanner/1.0"
    }
});

/**
 * Lấy danh sách cặp Spot USDT đang giao dịch.
 */
async function getSpotUsdtSymbols() {
    const url = `${SPOT_BASE_URL}/api/v3/exchangeInfo`;

    try {
        const response = await http.get(url);

        return response.data.symbols
            .filter(symbol =>
                symbol.quoteAsset === "USDT" &&
                symbol.status === "TRADING" &&
                symbol.isSpotTradingAllowed !== false
            )
            .map(symbol => symbol.symbol);
    } catch (error) {
        throw new Error(
            `Không lấy được danh sách Spot: ${getErrorMessage(error)}`
        );
    }
}

/**
 * Lấy giá Spot hiện tại của một cặp, ví dụ SOLUSDT.
 */
async function getSpotPrice(symbol) {
    const url = `${SPOT_BASE_URL}/api/v3/ticker/price`;

    try {
        const response = await http.get(url, {
            params: { symbol: normalizeSymbol(symbol) }
        });

        return Number(response.data.price);
    } catch (error) {
        throw new Error(
            `Không lấy được giá Spot ${symbol}: ${getErrorMessage(error)}`
        );
    }
}

/**
 * Lấy nến Spot OHLCV.
 *
 * Mỗi nến có:
 * openTime, open, high, low, close, volume,
 * closeTime, quoteVolume, trades,
 * takerBuyBaseVolume, takerBuyQuoteVolume.
 */
async function getSpotKlines(
    symbol,
    interval = "5m",
    limit = 100
) {
    const url = `${SPOT_BASE_URL}/api/v3/klines`;

    try {
        const response = await http.get(url, {
            params: {
                symbol: normalizeSymbol(symbol),
                interval,
                limit
            }
        });

        return response.data.map(kline => ({
            openTime: Number(kline[0]),
            open: Number(kline[1]),
            high: Number(kline[2]),
            low: Number(kline[3]),
            close: Number(kline[4]),
            volume: Number(kline[5]),
            closeTime: Number(kline[6]),
            quoteVolume: Number(kline[7]),
            trades: Number(kline[8]),
            takerBuyBaseVolume: Number(kline[9]),
            takerBuyQuoteVolume: Number(kline[10])
        }));
    } catch (error) {
        throw new Error(
            `Không lấy được nến Spot ${symbol}: ${getErrorMessage(error)}`
        );
    }
}

/**
 * Kiểm tra cặp có tồn tại và đang giao dịch
 * trên Binance USDⓈ-M Futures hay không.
 */
async function getFuturesPairInfo(symbol) {
    const normalized = normalizeSymbol(symbol);
    const url = `${FUTURES_BASE_URL}/fapi/v1/exchangeInfo`;

    try {
        const response = await http.get(url);

        const pair = response.data.symbols.find(item =>
            item.symbol === normalized &&
            item.quoteAsset === "USDT" &&
            item.status === "TRADING"
        );

        if (!pair) {
            return {
                available: false,
                symbol: normalized
            };
        }

        return {
            available: true,
            symbol: pair.symbol,
            baseAsset: pair.baseAsset,
            quoteAsset: pair.quoteAsset
        };
    } catch (error) {
        throw new Error(
            `Không kiểm tra được Futures ${normalized}: ${getErrorMessage(error)}`
        );
    }
}

/**
 * Lấy giá Futures nếu cặp khả dụng.
 */
async function getFuturesPrice(symbol) {
    const normalized = normalizeSymbol(symbol);

    try {
        const response = await http.get(
            `${FUTURES_BASE_URL}/fapi/v1/ticker/price`,
            { params: { symbol: normalized } }
        );

        return Number(response.data.price);
    } catch (error) {
        // Không coi lỗi mạng hoặc lỗi API là chắc chắn không có cặp.
        throw new Error(
            `Không lấy được giá Futures ${normalized}: ${getErrorMessage(error)}`
        );
    }
}

function normalizeSymbol(symbol) {
    return String(symbol).trim().toUpperCase();
}

function getErrorMessage(error) {
    if (error.response) {
        return `HTTP ${error.response.status}: ${
            JSON.stringify(error.response.data)
        }`;
    }

    return error.message || "Lỗi không xác định";
}

module.exports = {
    getSpotUsdtSymbols,
    getSpotPrice,
    getSpotKlines,
    getFuturesPairInfo,
    getFuturesPrice
};
