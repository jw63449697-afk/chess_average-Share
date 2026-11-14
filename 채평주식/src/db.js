import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

const databasePath = process.env.DATABASE_PATH ?? "./data/chaepyeong.sqlite";
const absoluteDatabasePath =
  databasePath === ":memory:" ? null : path.resolve(databasePath);
if (absoluteDatabasePath) {
  fs.mkdirSync(path.dirname(absoluteDatabasePath), { recursive: true });
}

const SQL = await initSqlJs();
const database = absoluteDatabasePath && fs.existsSync(absoluteDatabasePath)
  ? new SQL.Database(fs.readFileSync(absoluteDatabasePath))
  : new SQL.Database();
let transactionActive = false;

function persist() {
  if (!absoluteDatabasePath) {
    return;
  }
  const temporaryPath = `${absoluteDatabasePath}.tmp`;
  fs.writeFileSync(temporaryPath, Buffer.from(database.export()));
  fs.renameSync(temporaryPath, absoluteDatabasePath);
}

function prepare(sql) {
  return {
    run(...parameters) {
      database.run(sql, parameters);
      const result = { changes: database.getRowsModified() };
      if (!transactionActive) {
        persist();
      }
      return result;
    },
    get(...parameters) {
      const statement = database.prepare(sql);
      try {
        statement.bind(parameters);
        return statement.step() ? statement.getAsObject() : undefined;
      } finally {
        statement.free();
      }
    },
    all(...parameters) {
      const statement = database.prepare(sql);
      try {
        statement.bind(parameters);
        const rows = [];
        while (statement.step()) {
          rows.push(statement.getAsObject());
        }
        return rows;
      } finally {
        statement.free();
      }
    },
  };
}

export const db = {
  exec(sql) {
    database.exec(sql);
    if (!transactionActive) {
      persist();
    }
  },
  prepare,
  transaction(callback) {
    return (...args) => {
      database.run("BEGIN IMMEDIATE");
      transactionActive = true;
      let committed = false;
      try {
        const result = callback(...args);
        database.run("COMMIT");
        committed = true;
        transactionActive = false;
        persist();
        return result;
      } catch (error) {
        if (!committed) {
          try {
            database.run("ROLLBACK");
          } catch (rollbackError) {
            transactionActive = false;
            throw new AggregateError(
              [error, rollbackError],
              "Database transaction and rollback both failed.",
            );
          }
        }
        transactionActive = false;
        throw error;
      }
    };
  },
};

db.exec(`
  CREATE TABLE IF NOT EXISTS markets (
    guild_id TEXT PRIMARY KEY,
    price INTEGER NOT NULL CHECK (price >= 1)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 5000 CHECK (rating >= 0),
    shares INTEGER NOT NULL DEFAULT 0 CHECK (shares >= 0),
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    old_price INTEGER NOT NULL,
    new_price INTEGER NOT NULL,
    change_percent INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS price_history_guild_id_id
    ON price_history (guild_id, id DESC);

  CREATE TABLE IF NOT EXISTS sticker_events (
    message_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    sticker_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS check_ins (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    check_in_date TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, check_in_date)
  );
`);

const ensureMarket = db.prepare(
  "INSERT OR IGNORE INTO markets (guild_id, price) VALUES (?, 500)",
);
const ensureAccount = db.prepare(
  "INSERT OR IGNORE INTO accounts (guild_id, user_id) VALUES (?, ?)",
);

export function getMarket(guildId) {
  ensureMarket.run(guildId);
  return db.prepare("SELECT price FROM markets WHERE guild_id = ?").get(guildId);
}

export function getAccount(guildId, userId) {
  ensureAccount.run(guildId, userId);
  return db
    .prepare("SELECT rating, shares FROM accounts WHERE guild_id = ? AND user_id = ?")
    .get(guildId, userId);
}

export function getRecentPriceHistory(guildId, limit = 5) {
  return db
    .prepare(
      `SELECT old_price, new_price, change_percent
       FROM (
         SELECT id, old_price, new_price, change_percent
         FROM price_history
         WHERE guild_id = ?
         ORDER BY id DESC
         LIMIT ?
       )
       ORDER BY id ASC`,
    )
    .all(guildId, limit);
}

export function buyShares(guildId, userId, amount) {
  return db.transaction(() => {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return { ok: false, reason: "invalid_amount" };
    }

    ensureMarket.run(guildId);
    ensureAccount.run(guildId, userId);
    const price = db
      .prepare("SELECT price FROM markets WHERE guild_id = ?")
      .get(guildId).price;
    let shares = Math.round(amount / price);
    if (shares * price > amount) {
      shares -= 1;
    }
    if (shares < 1) {
      return { ok: false, reason: "too_small", price };
    }

    const cost = shares * price;
    const account = db
      .prepare("SELECT rating FROM accounts WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId);
    if (account.rating < cost) {
      return { ok: false, reason: "insufficient_funds", price };
    }

    db.prepare(
      `UPDATE accounts
       SET rating = rating - ?, shares = shares + ?
       WHERE guild_id = ? AND user_id = ?`,
    ).run(cost, shares, guildId, userId);
    const remaining = db
      .prepare("SELECT rating FROM accounts WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId).rating;
    return { ok: true, cost, shares, remaining };
  })();
}

export function sellShares(guildId, userId, shares) {
  return db.transaction(() => {
    if (!Number.isSafeInteger(shares) || shares <= 0) {
      return { ok: false, reason: "invalid_shares" };
    }

    ensureMarket.run(guildId);
    ensureAccount.run(guildId, userId);
    const price = db
      .prepare("SELECT price FROM markets WHERE guild_id = ?")
      .get(guildId).price;
    const account = db
      .prepare("SELECT shares FROM accounts WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId);
    if (account.shares < shares) {
      return { ok: false, reason: "insufficient_shares", owned: account.shares };
    }

    const proceeds = shares * price;
    db.prepare(
      `UPDATE accounts
       SET rating = rating + ?, shares = shares - ?
       WHERE guild_id = ? AND user_id = ?`,
    ).run(proceeds, shares, guildId, userId);
    const balance = db
      .prepare("SELECT rating FROM accounts WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId).rating;
    return { ok: true, proceeds, balance };
  })();
}

export function claimDailyCheckIn(guildId, userId, date) {
  return db.transaction(() => {
    ensureAccount.run(guildId, userId);
    const result = db
      .prepare(
        "INSERT OR IGNORE INTO check_ins (guild_id, user_id, check_in_date) VALUES (?, ?, ?)",
      )
      .run(guildId, userId, date);
    if (result.changes === 0) {
      return { ok: false };
    }

    db.prepare(
      "UPDATE accounts SET rating = rating + 600 WHERE guild_id = ? AND user_id = ?",
    ).run(guildId, userId);
    const balance = db
      .prepare("SELECT rating FROM accounts WHERE guild_id = ? AND user_id = ?")
      .get(guildId, userId).rating;
    return { ok: true, balance };
  })();
}

export function applyStickerChange({ messageId, guildId, stickerId, changePercent }) {
  return db.transaction(() => {
    ensureMarket.run(guildId);
    const inserted = db
      .prepare(
        "INSERT OR IGNORE INTO sticker_events (message_id, guild_id, sticker_id) VALUES (?, ?, ?)",
      )
      .run(messageId, guildId, stickerId);
    if (inserted.changes === 0) {
      return { applied: false };
    }

    const oldPrice = db
      .prepare("SELECT price FROM markets WHERE guild_id = ?")
      .get(guildId).price;
    const newPrice = Math.max(1, Math.round(oldPrice * (1 + changePercent / 100)));
    db.prepare("UPDATE markets SET price = ? WHERE guild_id = ?").run(newPrice, guildId);
    db.prepare(
      `INSERT INTO price_history (guild_id, old_price, new_price, change_percent)
       VALUES (?, ?, ?, ?)`,
    ).run(guildId, oldPrice, newPrice, changePercent);
    return { applied: true, oldPrice, newPrice };
  })();
}

export function getShareRanking(guildId, userId) {
  return db.transaction(() => {
    ensureMarket.run(guildId);
    ensureAccount.run(guildId, userId);
    const price = db
      .prepare("SELECT price FROM markets WHERE guild_id = ?")
      .get(guildId).price;
    const account = db
      .prepare(
        `SELECT shares, rating, rating + shares * ? AS total_assets
         FROM accounts
         WHERE guild_id = ? AND user_id = ?`,
      )
      .get(price, guildId, userId);
    const rank = db
      .prepare(
        `SELECT COUNT(*) + 1 AS rank
         FROM accounts
         WHERE guild_id = ?
           AND (
             rating + shares * ? > ?
             OR (rating + shares * ? = ? AND user_id < ?)
           )`,
      )
      .get(
        guildId,
        price,
        account.total_assets,
        price,
        account.total_assets,
        userId,
      ).rank;
    const topFive = db
      .prepare(
        `SELECT user_id, shares, rating, rating + shares * ? AS total_assets
         FROM accounts
         WHERE guild_id = ?
         ORDER BY total_assets DESC, user_id ASC
         LIMIT 5`,
      )
      .all(price, guildId);
    return { rank, shares: account.shares, totalAssets: account.total_assets, topFive };
  })();
}
