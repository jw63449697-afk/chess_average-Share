import { SlashCommandBuilder } from "discord.js";

export const commands = [
  new SlashCommandBuilder()
    .setName("현재주가")
    .setDescription("현재 주가와 최근 변동 내역을 확인합니다."),
  new SlashCommandBuilder()
    .setName("매수")
    .setDescription("레이트를 사용해 채평주식을 매수합니다.")
    .addIntegerOption((option) =>
      option
        .setName("금액")
        .setDescription("사용할 레이트 금액")
        .setMinValue(1)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("매도")
    .setDescription("보유한 채평주식을 매도합니다.")
    .addIntegerOption((option) =>
      option
        .setName("수량")
        .setDescription("매도할 주식 수")
        .setMinValue(1)
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("채평주식보유량")
    .setDescription("보유 주식 수와 현재 평가액을 확인합니다."),
  new SlashCommandBuilder()
    .setName("레이트확인")
    .setDescription("현재 레이트 잔액을 확인합니다."),
  new SlashCommandBuilder()
    .setName("출석체크")
    .setDescription("KST 기준 하루 한 번 출석 보상을 받습니다."),
  new SlashCommandBuilder()
    .setName("랭킹")
    .setDescription("총자산 기준 본인 순위와 상위 5명을 확인합니다."),
].map((command) => command.toJSON());
