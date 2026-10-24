
const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "../../logs");
const LOG_FILE = path.join(LOG_DIR, "scanner.log");

const LEVELS = {
    INFO: "INFO",
    WARN: "WARN",
    ERROR: "ERROR",
    RATE_LIMIT: "RATE_LIMIT"
};

function ensureLogDirectory() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

function serializeError(error) {
    if (!error) return null;

    return {
        name: error.name,
        message: error.message,
        code: error.code,
        status: error.status,
        endpoint: error.endpoint,
        symbol: error.symbol,
        retryAfter: error.retryAfter,
        responseData: error.responseData,
        headers: error.headers
    };
}

function write(level, message, details = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...details
    };

    const line = JSON.stringify(entry);

    // Hiển thị log trên Terminal.
    const output = level === LEVELS.ERROR ||
        level === LEVELS.RATE_LIMIT
        ? console.error
        : level === LEVELS.WARN
            ? console.warn
            : console.log;

    output(line);

    // Ghi log xuống file để kiểm tra lại sau khi chương trình chạy.
    try {
        ensureLogDirectory();
        fs.appendFileSync(LOG_FILE, `${line}\n`, "utf8");
    } catch (error) {
        console.error(
            "[LOGGER_WRITE_ERROR]",
            error.message
        );
    }
}

module.exports = {
    info: (message, details) =>
        write(LEVELS.INFO, message, details),

    warn: (message, details) =>
        write(LEVELS.WARN, message, details),

    error: (message, details) =>
        write(LEVELS.ERROR, message, details),

    rateLimit: (message, details) =>
        write(LEVELS.RATE_LIMIT, message, details),

    serializeError,
    LOG_FILE
};
