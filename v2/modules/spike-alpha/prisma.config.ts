import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "v2/modules/spike-alpha/prisma/schema.prisma",
  migrations: {
    path: "v2/modules/spike-alpha/prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
