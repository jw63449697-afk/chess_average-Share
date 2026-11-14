import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_PATH = ":memory:";
const { db, applyStickerChange, getShareRanking } = await import("../src/db.js");

test("ranking orders users by rating plus the current share value", () => {
  const accounts = [
    ["guild", "a", 5000, 2],
    ["guild", "b", 7000, 0],
    ["guild", "c", 3000, 10],
    ["guild", "d", 5000, 0],
    ["guild", "e", 9000, 0],
    ["guild", "f", 5000, 2],
  ];
  const insertAccount = db.prepare(
    "INSERT INTO accounts (guild_id, user_id, rating, shares) VALUES (?, ?, ?, ?)",
  );
  for (const account of accounts) {
    insertAccount.run(...account);
  }

  const result = getShareRanking("guild", "a");
  assert.equal(result.totalAssets, 6000);
  assert.equal(result.rank, 4);
  assert.deepEqual(
    result.topFive.map((account) => account.user_id),
    ["e", "c", "b", "a", "f"],
  );
});

test("ranking recalculates share values at the current market price", () => {
  db.prepare(
    "INSERT INTO accounts (guild_id, user_id, rating, shares) VALUES (?, ?, ?, ?)",
  ).run("moving-market", "cash", 6000, 0);
  db.prepare(
    "INSERT INTO accounts (guild_id, user_id, rating, shares) VALUES (?, ?, ?, ?)",
  ).run("moving-market", "stock", 5000, 2);

  assert.equal(getShareRanking("moving-market", "stock").rank, 2);
  applyStickerChange({
    messageId: "unique-market-change",
    guildId: "moving-market",
    stickerId: "up",
    changePercent: 10,
  });
  assert.equal(getShareRanking("moving-market", "stock").rank, 1);
});
