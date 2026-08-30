import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";

const scenario = process.argv[2];

const modules = {
  alpha: {
    config: "v2/modules/spike-alpha/prisma.config.ts",
    table: "V2SpikeAlpha",
    brokenMigrationDir:
      "v2/modules/spike-alpha/prisma/migrations/20991231000100_spike_alpha_broken",
  },
  beta: {
    config: "v2/modules/spike-beta/prisma.config.ts",
    table: "V2SpikeBeta",
    brokenMigrationDir:
      "v2/modules/spike-beta/prisma/migrations/20991231000200_spike_beta_broken",
  },
};

const supported = new Set([
  "alpha-only",
  "beta-only",
  "alpha-then-beta",
  "beta-then-alpha",
  "broken-alpha-locality",
  "broken-beta-locality",
]);

if (!supported.has(scenario)) {
  throw new Error(`Unsupported scenario: ${scenario ?? "<missing>"}`);
}

function runPrisma(moduleName, expectedSuccess = true) {
  const module = modules[moduleName];
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "migrate", "deploy", "--config", module.config],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    },
  );

  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");

  const succeeded = result.status === 0;
  if (succeeded !== expectedSuccess) {
    throw new Error(
      `${moduleName} migrate deploy ${succeeded ? "succeeded" : "failed"}; expected ${expectedSuccess ? "success" : "failure"}`,
    );
  }
}

async function withDatabase(callback) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function tableExists(tableName) {
  return withDatabase(async (client) => {
    const result = await client.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS present`,
      [tableName],
    );
    return result.rows[0]?.present === true;
  });
}

async function requireTable(moduleName, expected) {
  const present = await tableExists(modules[moduleName].table);
  if (present !== expected) {
    throw new Error(
      `${modules[moduleName].table} presence=${present}; expected ${expected}`,
    );
  }
}

function injectBrokenMigration(moduleName) {
  const directory = modules[moduleName].brokenMigrationDir;
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    `${directory}/migration.sql`,
    `CREATE TABLE "V2Broken${moduleName}" (\n  "id" TEXT NOT NULL,\n  BROKEN SQL HERE\n);\n`,
    "utf8",
  );
}

async function run() {
  switch (scenario) {
    case "alpha-only":
      runPrisma("alpha");
      await requireTable("alpha", true);
      await requireTable("beta", false);
      break;

    case "beta-only":
      runPrisma("beta");
      await requireTable("beta", true);
      await requireTable("alpha", false);
      break;

    case "alpha-then-beta":
      runPrisma("alpha");
      runPrisma("beta");
      await requireTable("alpha", true);
      await requireTable("beta", true);
      break;

    case "beta-then-alpha":
      runPrisma("beta");
      runPrisma("alpha");
      await requireTable("alpha", true);
      await requireTable("beta", true);
      break;

    case "broken-alpha-locality":
      runPrisma("beta");
      injectBrokenMigration("alpha");
      runPrisma("alpha", false);
      await requireTable("beta", true);
      runPrisma("beta");
      await requireTable("beta", true);
      break;

    case "broken-beta-locality":
      runPrisma("alpha");
      injectBrokenMigration("beta");
      runPrisma("beta", false);
      await requireTable("alpha", true);
      runPrisma("alpha");
      await requireTable("alpha", true);
      break;
  }

  console.log(`V2 Prisma isolation scenario GREEN: ${scenario}`);
}

await run();
