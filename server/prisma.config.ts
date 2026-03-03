import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  // Prisma 7: move the connection URL out of schema.prisma into prisma.config.ts
  datasource: {
    url: env("DATABASE_URL"),
  },
});