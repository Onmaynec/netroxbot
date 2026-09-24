import "dotenv/config";
import { prisma } from "./client.js";

function required(name: "DISCORD_GUILD_ID" | "SUPERADMIN_DISCORD_ID"): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} не задан`);
  }

  return value;
}

const guildId = required("DISCORD_GUILD_ID");
const superAdminId = required("SUPERADMIN_DISCORD_ID");

try {
  await prisma.$transaction([
    prisma.guildConfig.upsert({
      where: { guildId },
      update: {
        locale: "ru",
        accentHex: "#57F287"
      },
      create: {
        guildId,
        locale: "ru",
        accentHex: "#57F287"
      }
    }),
    prisma.adminUser.upsert({
      where: { discordId: superAdminId },
      update: {
        level: "SUPERADMIN",
        revokedAt: null
      },
      create: {
        discordId: superAdminId,
        level: "SUPERADMIN"
      }
    })
  ]);

  console.log("Bootstrap базы NetroxBot завершён.");
} catch (error) {
  console.error("Не удалось выполнить bootstrap базы NetroxBot.", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
