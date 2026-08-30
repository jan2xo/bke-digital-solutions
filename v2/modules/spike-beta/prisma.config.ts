import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "v2/modules/spike-beta/prisma/schema.prisma",
  migrations: {
    path: "v2/modules/spike-beta/prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
