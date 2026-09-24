import "dotenv/config";
import { MODULES } from "@netrox/core";
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
  await prisma.guildConfig.upsert({
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
  });

  await prisma.$transaction([
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
    }),
    ...MODULES.map((module) =>
      prisma.moduleConfig.upsert({
        where: {
          guildId_moduleKey: {
            guildId,
            moduleKey: module.key
          }
        },
        update: {},
        create: {
          guildId,
          moduleKey: module.key,
          enabled: module.defaultEnabled,
          settings: {}
        }
      })
    )
  ]);

  console.log(`Bootstrap базы NetroxBot завершён. Модулей: ${MODULES.length}.`);
} catch (error) {
  console.error("Не удалось выполнить bootstrap базы NetroxBot.", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
