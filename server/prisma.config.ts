import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  // Prisma CLI (migrate deploy) uses connection URLs from config in Prisma 7
  // NOTE: "datasources" is the supported key (plural).
  datasources: {
    db: {
      url: env("DATABASE_URL"),
    },
  },
});