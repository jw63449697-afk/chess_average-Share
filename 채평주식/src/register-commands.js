import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

const { DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_APPLICATION_ID) {
  throw new Error("DISCORD_TOKEN and DISCORD_APPLICATION_ID are required.");
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
const route = DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_GUILD_ID)
  : Routes.applicationCommands(DISCORD_APPLICATION_ID);

await rest.put(route, { body: commands });
console.log(
  `Registered ${commands.length} slash commands${DISCORD_GUILD_ID ? ` for guild ${DISCORD_GUILD_ID}` : " globally"}.`,
);
