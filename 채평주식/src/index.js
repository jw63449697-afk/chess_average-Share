import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import {
  applyStickerChange,
  buyShares,
  claimDailyCheckIn,
  getAccount,
  getMarket,
  getRecentPriceHistory,
  getShareRanking,
  sellShares,
} from "./db.js";

const UP_STICKER_ID = "1541806304278876221";
const DOWN_STICKER_ID = "1541806243608526850";
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

function kstDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatNumber(number) {
  return new Intl.NumberFormat("ko-KR").format(number);
}

async function handleCommand(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "이 명령어는 서버 안에서만 사용할 수 있습니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { guildId, user } = interaction;
  switch (interaction.commandName) {
    case "현재주가": {
      const market = getMarket(guildId);
      const history = getRecentPriceHistory(guildId);
      const entries = history.length
        ? history
            .map((item, index) => {
              const direction = item.change_percent > 0 ? "상승" : "하락";
              const percent = `${item.change_percent > 0 ? "+" : ""}${item.change_percent}%`;
              return (
                `${["①", "②", "③", "④", "⑤"][index]} ${direction} ${percent} ` +
                `(${formatNumber(item.old_price)} → ${formatNumber(item.new_price)}레이트)`
              );
            })
            .join("\n")
        : "아직 주가 변동 내역이 없습니다.";
      const currentPercent = ((market.price - 500) / 500) * 100;
      const sign = currentPercent > 0 ? "+" : "";
      await interaction.reply({
        content:
          `📈 채평주식 현황\n\n━━━━━━━━━━━━━━━━\n📜 최근 주가 변동\n\n시작가: 500\n\n${entries}\n\n` +
          `━━━━━━━━━━━━━━━━\n💰 현재 주가 : ${formatNumber(market.price)}레이트\n\n` +
          `📉 시작가 대비: ${sign}${currentPercent.toFixed(1)}%\n━━━━━━━━━━━━━━━━`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case "매수": {
      const amount = interaction.options.getInteger("금액", true);
      const result = buyShares(guildId, user.id, amount);
      const content = !result.ok
        ? result.reason === "invalid_amount"
          ? "매수 금액은 0보다 큰 정수여야 합니다."
          : result.reason === "too_small"
            ? `현재 주가(${formatNumber(result.price)}레이트)보다 적은 금액으로는 매수할 수 없습니다.`
            : "레이트 잔액이 부족합니다."
        : `📈 채평주식 매수 완료!\n\n매수 금액 : ${formatNumber(result.cost)}레이트\n매수 수량 : ${formatNumber(result.shares)}주\n남은 레이트 : ${formatNumber(result.remaining)}레이트`;
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }
    case "매도": {
      const shares = interaction.options.getInteger("수량", true);
      const result = sellShares(guildId, user.id, shares);
      const content = !result.ok
        ? result.reason === "invalid_shares"
          ? "매도 수량은 0보다 큰 정수여야 합니다."
          : `보유 주식이 부족합니다. 현재 보유량: ${formatNumber(result.owned)}주`
        : `📉 채평주식 매도 완료!\n\n매도 수량 : ${formatNumber(shares)}주\n판매 금액 : ${formatNumber(result.proceeds)}레이트\n현재 레이트 : ${formatNumber(result.balance)}레이트`;
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }
    case "채평주식보유량": {
      const account = getAccount(guildId, user.id);
      const price = getMarket(guildId).price;
      await interaction.reply({
        content:
          `📊 채평주식 보유 현황\n\n보유 수량 : ${formatNumber(account.shares)}주\n` +
          `현재 주가 : ${formatNumber(price)}레이트\n총 평가액 : ${formatNumber(account.shares * price)}레이트`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case "레이트확인": {
      const account = getAccount(guildId, user.id);
      const nickname =
        typeof interaction.member?.displayName === "string"
          ? interaction.member.displayName
          : user.globalName ?? user.username;
      await interaction.reply({
        content: `💰 레이트 잔액\n\n현재 ${nickname}님의 레이트는\n${formatNumber(account.rating)}레이트입니다.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    case "출석체크": {
      const result = claimDailyCheckIn(guildId, user.id, kstDate());
      const content = result.ok
        ? `✅ 출석체크 완료!\n\n600레이트를 받았습니다.\n현재 레이트: ${formatNumber(result.balance)}레이트`
        : "❌ 출석체크를 이미 오늘 했습니다.";
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
    }
    case "랭킹": {
      const ranking = getShareRanking(guildId, user.id);
      const leaders = ranking.topFive.length
        ? ranking.topFive
            .map(
              (entry, index) =>
                `${index + 1}위  <@${entry.user_id}> — 총자산 ${formatNumber(entry.total_assets)}레이트`,
            )
            .join("\n")
        : "랭킹 데이터가 없습니다.";
      await interaction.reply({
        content:
          `🏆 채평주식 총자산 랭킹\n\n내 순위 : ${ranking.rank}위 (총자산 ${formatNumber(ranking.totalAssets)}레이트)\n\n` +
          `━━━━━━━━━━━━━━━━\n🥇 TOP 5\n${leaders}`,
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    default:
      throw new Error(`Unknown command: ${interaction.commandName}`);
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }
  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(`Command failed (${interaction.commandName}):`, error);
    const response = {
      content: "명령어 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

client.on("messageCreate", (message) => {
  if (!message.guildId || message.author.bot) {
    return;
  }

  for (const sticker of message.stickers.values()) {
    const changePercent =
      sticker.id === UP_STICKER_ID && sticker.name === "up"
        ? Math.floor(Math.random() * 4) + 3
        : sticker.id === DOWN_STICKER_ID && sticker.name === "down"
          ? -(Math.floor(Math.random() * 3) + 2)
          : null;
    if (changePercent === null) {
      continue;
    }

    try {
      applyStickerChange({
        messageId: message.id,
        guildId: message.guildId,
        stickerId: sticker.id,
        changePercent,
      });
    } catch (error) {
      console.error(`Failed to apply sticker event (${message.id}):`, error);
    }
    break;
  }
});

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

if (!process.env.DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is required.");
}

await client.login(process.env.DISCORD_TOKEN);
