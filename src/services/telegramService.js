const axios = require("axios");
const logger = require("./logger");

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 3500;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function formatNumber(value, digits = 8) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "N/A";
    }

    return number.toLocaleString("en-US", {
        maximumSignificantDigits: digits
    });
}

function formatPercent(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "N/A";
    }

    return `${number.toFixed(2)}%`;
}

async function sendMessage(text) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
        throw new Error(
            "Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong .env"
        );
    }

    try {
        await axios.post(
            `${TELEGRAM_API}/bot${token}/sendMessage`,
            {
                chat_id: chatId,
                text,
                parse_mode: "HTML",
                disable_web_page_preview: true
            },
            {
                timeout: 15000
            }
        );

        logger.info("Telegram message sent successfully");
    } catch (error) {
        logger.error("Telegram message failed", {
            status: error.response?.status ?? null,
            description:
                error.response?.data?.description ??
                error.message
        });

        throw new Error(
            error.response?.data?.description ??
            "Không gửi được tin nhắn Telegram"
        );
    }
}

function buildTokenLine(token) {
    return [
        `• <b>${escapeHtml(token.symbol)}</b>`,
        `Giá: <code>${formatNumber(token.currentPrice ?? token.closePrice)}</code>`,
        `VolRatio: <b>${formatNumber(token.volRatio, 5)}x</b>`,
        `RSI: ${formatNumber(token.rsi14, 5)}`,
        `EMA20: ${formatNumber(token.priceVsEma20Pct)}%`,
        `EMA50: ${formatNumber(token.priceVsEma50Pct)}%`,
        `15m: ${formatPercent(token.change15mPct)}`
    ].join(" | ");
}

function splitIntoMessages(header, lines) {
    const messages = [];
    let current = header;

    for (const line of lines) {
        const candidate = `${current}\n\n${line}`;

        if (
            candidate.length > MAX_MESSAGE_LENGTH &&
            current !== header
        ) {
            messages.push(current);
            current = `${header}\n\n${line}`;
        } else {
            current = candidate;
        }
    }

    if (current) {
        messages.push(current);
    }

    return messages;
}

async function sendScanResults(result) {
    const timestamp = new Date().toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo"
    });

    const header = [
        "🔎 <b>BINANCE SPOT SCANNER — 15m</b>",
        `Thời gian: ${timestamp}`,
        `Đã quét: ${result.symbols.length} cặp`,
        `Đạt VolRatio ≥ 2: ${result.matches.length}`,
        `Lỗi: ${result.errors.length}`,
        `Thời gian chạy: ${result.elapsedSeconds}s`
    ].join("\n");

    if (result.stoppedByRateLimit) {
        await sendMessage(
            `${header}\n\n⚠️ Scanner đã dừng do rate limit.`
        );
        return;
    }

    if (result.matches.length === 0) {
        await sendMessage(
            `${header}\n\nKhông có token đạt điều kiện trong lượt quét này.`
        );
        return;
    }

    const lines = result.matches.map(buildTokenLine);
    const messages = splitIntoMessages(header, lines);

    for (const message of messages) {
        await sendMessage(message);
    }
}

module.exports = {
    sendMessage,
    sendScanResults
};