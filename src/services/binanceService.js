
const axios = require("axios");
const logger = require("./logger");

const SPOT_BASE_URL = "https://api.binance.com";
const FUTURES_BASE_URL = "https://fapi.binance.com";

const http = axios.create({
    timeout: 15000,
    headers: {
        "User-Agent": "binance-volratio-scanner/1.0"
    }
});

// Lấy các header liên quan đến rate limit nếu Binance cung cấp.
function getRelevantHeaders(headers = {}) {
    const result = {};

    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();

        if (
            lowerKey === "retry-after" ||
            lowerKey.startsWith("x-mbx-used-weight") ||
            lowerKey === "x-mbx-order-count-1m"
        ) {
            result[key] = value;
        }
    }

    return result;
}

// Giữ thông tin lỗi gốc để scanner có thể quyết định retry,
// tạm dừng worker và ghi log theo HTTP status.
function normalizeApiError(error, { endpoint, symbol } = {}) {
    const response = error.response;
    const status = response?.status;
    const headers = getRelevantHeaders(response?.headers);

    const apiError = new Error(
        response
            ? `HTTP ${status}: ${JSON.stringify(response.data)}`
            : error.message || "Lỗi không xác định"
    );

    apiError.name = "BinanceApiError";
    apiError.status = status ?? null;
    apiError.code = error.code ?? null;
    apiError.endpoint = endpoint;
    apiError.symbol = symbol ?? null;
    apiError.headers = headers;
    apiError.responseData = response?.data ?? null;
    apiError.retryAfter = headers["retry-after"] ??
        headers["Retry-After"] ??
        null;

    const details = {
        endpoint,
        symbol: symbol ?? null,
        status: apiError.status,
        code: apiError.code,
        headers,
        responseData: apiError.responseData,
        retryAfter: apiError.retryAfter
    };

    if (status === 418 || status === 429) {
        logger.rateLimit("Binance rate limit hoặc IP restriction", details);
    } else {
        logger.error("Binance API request thất bại", details);
    }

    return apiError;
}

async function request(config, context = {}) {
    try {
        const response = await http.request(config);

        const headers = getRelevantHeaders(response.headers);

        if (Object.keys(headers).length > 0) {
            logger.info("Binance response headers", {
                endpoint: context.endpoint,
                symbol: context.symbol ?? null,
                headers
            });
        }

        return response;
    } catch (error) {
        throw normalizeApiError(error, context);
    }
}

/**
 * Lấy danh sách cặp Spot USDT đang giao dịch.
 */
async function getSpotUsdtSymbols() {
    const endpoint = "/api/v3/exchangeInfo";

    const response = await request(
        {
            method: "GET",
            baseURL: SPOT_BASE_URL,
            url: endpoint
        },
        { endpoint }
    );

    return response.data.symbols
        .filter(symbol =>
            symbol.quoteAsset === "USDT" &&
            symbol.status === "TRADING" &&
            symbol.isSpotTradingAllowed !== false
        )
        .map(symbol => symbol.symbol);
}

/**
 * Lấy giá Spot hiện tại.
 */
async function getSpotPrice(symbol) {
    const normalized = normalizeSymbol(symbol);
    const endpoint = "/api/v3/ticker/price";

    const response = await request(
        {
            method: "GET",
            baseURL: SPOT_BASE_URL,
            url: endpoint,
            params: { symbol: normalized }
        },
        { endpoint, symbol: normalized }
    );

    return Number(response.data.price);
}

/**
 * Lấy nến Spot OHLCV.
 */
async function getSpotKlines(
    symbol,
    interval = "5m",
    limit = 100
) {
    const normalized = normalizeSymbol(symbol);
    const endpoint = "/api/v3/klines";

    const response = await request(
        {
            method: "GET",
            baseURL: SPOT_BASE_URL,
            url: endpoint,
            params: {
                symbol: normalized,
                interval,
                limit
            }
        },
        { endpoint, symbol: normalized }
    );

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
}

/**
 * Kiểm tra cặp có tồn tại và đang giao dịch
 * trên Binance USDⓈ-M Futures hay không.
 */
async function getFuturesPairInfo(symbol) {
    const normalized = normalizeSymbol(symbol);
    const endpoint = "/fapi/v1/exchangeInfo";

    const response = await request(
        {
            method: "GET",
            baseURL: FUTURES_BASE_URL,
            url: endpoint
        },
        { endpoint, symbol: normalized }
    );

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
}

/**
 * Lấy giá Futures nếu cặp khả dụng.
 */
async function getFuturesPrice(symbol) {
    const normalized = normalizeSymbol(symbol);
    const endpoint = "/fapi/v1/ticker/price";

    const response = await request(
        {
            method: "GET",
            baseURL: FUTURES_BASE_URL,
            url: endpoint,
            params: { symbol: normalized }
        },
        { endpoint, symbol: normalized }
    );

    return Number(response.data.price);
}

async function getSpot24hrTickers() {
    const url = `${SPOT_BASE_URL}/api/v3/ticker/24hr`;

    try {
        const response = await http.get(url);

        return new Map(
            response.data.map(item => [
                item.symbol,
                {
                    currentPrice: Number(item.lastPrice),
                    change24hPct: Number(item.priceChangePercent)
                }
            ])
        );
    } catch (error) {
        throw new Error(
            `Không lấy được ticker 24h: ${getErrorMessage(error)}`
        );
    }
}

function normalizeSymbol(symbol) {
    return String(symbol).trim().toUpperCase();
}

module.exports = {
    getSpotUsdtSymbols,
    getSpotPrice,
    getSpotKlines,
    getFuturesPairInfo,
    getFuturesPrice,
    getSpot24hrTickers
};
