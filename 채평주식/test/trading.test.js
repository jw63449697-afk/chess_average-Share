import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.DATABASE_PATH = ":memory:";
const {
  db,
  applyStickerChange,
  buyShares,
  claimDailyCheckIn,
  getAccount,
  getMarket,
  getRecentPriceHistory,
  sellShares,
} = await import("../src/db.js");

test("buy rounds to a whole share without spending more than requested", () => {
  getMarket("buy-rounding");
  db.prepare("UPDATE markets SET price = 300 WHERE guild_id = ?").run("buy-rounding");

  const roundedDown = buyShares("buy-rounding", "buyer", 1000);
  assert.deepEqual(roundedDown, {
    ok: true,
    cost: 900,
    shares: 3,
    remaining: 4100,
  });

  db.prepare("UPDATE markets SET price = 400 WHERE guild_id = ?").run("buy-rounding");
  const capped = buyShares("buy-rounding", "buyer", 1000);
  assert.equal(capped.ok, true);
  assert.equal(capped.cost, 800);
  assert.equal(capped.shares, 2);
  assert.ok(capped.cost <= 1000);
});

test("trades reject invalid input and insufficient balance or shares", () => {
  assert.equal(buyShares("validation", "buyer", 0).reason, "invalid_amount");
  assert.equal(buyShares("validation", "buyer", 1.5).reason, "invalid_amount");
  assert.equal(buyShares("validation", "buyer", 499).reason, "too_small");
  assert.equal(sellShares("validation", "buyer", 0).reason, "invalid_shares");
  assert.equal(sellShares("validation", "buyer", 1).reason, "insufficient_shares");

  db.prepare(
    "UPDATE accounts SET rating = 100 WHERE guild_id = ? AND user_id = ?",
  ).run("validation", "buyer");
  assert.equal(buyShares("validation", "buyer", 500).reason, "insufficient_funds");
});

test("selling credits proceeds and sequential trades use the updated account", () => {
  db.prepare(
    "INSERT INTO accounts (guild_id, user_id, rating, shares) VALUES (?, ?, ?, ?)",
  ).run("sell", "seller", 1000, 3);

  const sold = sellShares("sell", "seller", 2);
  assert.deepEqual(sold, { ok: true, proceeds: 1000, balance: 2000 });
  assert.deepEqual(getAccount("sell", "seller"), { rating: 2000, shares: 1 });
});

test("sticker history is deduplicated and returns the latest five oldest-first", () => {
  for (let index = 1; index <= 6; index += 1) {
    const result = applyStickerChange({
      messageId: `history-${index}`,
      guildId: "history",
      stickerId: "up",
      changePercent: index,
    });
    assert.equal(result.applied, true);
  }
  assert.equal(
    applyStickerChange({
      messageId: "history-6",
      guildId: "history",
      stickerId: "up",
      changePercent: 6,
    }).applied,
    false,
  );

  const history = getRecentPriceHistory("history");
  assert.deepEqual(
    history.map((entry) => entry.change_percent),
    [2, 3, 4, 5, 6],
  );
  assert.equal(history[0].old_price, 505);
  assert.equal(history[4].new_price, getMarket("history").price);
});

test("check-in is awarded once per date and can be claimed on the next date", () => {
  assert.equal(claimDailyCheckIn("daily", "user", "2026-11-14").ok, true);
  assert.equal(claimDailyCheckIn("daily", "user", "2026-11-14").ok, false);
  assert.equal(claimDailyCheckIn("daily", "user", "2026-11-15").ok, true);
  assert.equal(getAccount("daily", "user").rating, 6200);
});

test("market and account data survive a process restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "chaepyeong-test-"));
  const databasePath = join(directory, "market.sqlite");
  const moduleUrl = new URL("../src/db.js", import.meta.url).href;
  const env = { ...process.env, DATABASE_PATH: databasePath };

  try {
    const setup = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { getMarket, buyShares, applyStickerChange } = await import(${JSON.stringify(moduleUrl)});` +
          `getMarket("persist");` +
          `buyShares("persist", "user", 1000);` +
          `applyStickerChange({ messageId: "persist-change", guildId: "persist", stickerId: "up", changePercent: 5 });`,
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(setup.status, 0, setup.stderr);

    const verify = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { getMarket, getAccount } = await import(${JSON.stringify(moduleUrl)});` +
          `console.log(JSON.stringify({ market: getMarket("persist"), account: getAccount("persist", "user") }));`,
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(verify.status, 0, verify.stderr);
    assert.deepEqual(JSON.parse(verify.stdout), {
      market: { price: 525 },
      account: { rating: 4000, shares: 2 },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
