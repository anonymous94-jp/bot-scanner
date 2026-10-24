
const assert = require("node:assert/strict");

const {
    createRateLimitCoordinator
} = require("../services/rateLimitCoordinator");

async function test429SharedBlock() {
    const coordinator = createRateLimitCoordinator();

    const before = Date.now();

    coordinator.block({
        status: 429,
        retryAfter: "2",
        symbol: "TESTUSDT",
        endpoint: "/api/v3/klines"
    });

    const blockedUntil = coordinator.getBlockedUntil();

    assert.ok(blockedUntil >= before + 1900);
    assert.equal(coordinator.isStopped(), false);

    // Mô phỏng worker phải chờ bộ điều phối.
    await coordinator.waitUntilAllowed();

    assert.ok(Date.now() >= blockedUntil);

    console.log("PASS: 429 chặn request mới theo Retry-After");
}

async function test418WithoutRetryAfter() {
    const coordinator = createRateLimitCoordinator();

    coordinator.block({
        status: 418,
        symbol: "TESTUSDT",
        endpoint: "/api/v3/klines"
    });

    assert.equal(coordinator.isStopped(), true);

    await assert.rejects(
        () => coordinator.waitUntilAllowed(),
        /HTTP 418/
    );

    console.log("PASS: 418 không có Retry-After sẽ dừng an toàn");
}

async function main() {
    await test429SharedBlock();
    await test418WithoutRetryAfter();

    console.log("\nAll rate limit tests passed!");
}

main().catch(error => {
    console.error("TEST FAILED:", error);
    process.exitCode = 1;
});
