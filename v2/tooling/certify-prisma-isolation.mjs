import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "pg";

const scenario = process.argv[2];

const modules = {
  alpha: {
    moduleId: "spike-alpha",
    config: "v2/modules/spike-alpha/prisma.config.ts",
    table: "V2SpikeAlpha",
    initialMigration: "20260831000100_spike_alpha_initial",
    brokenMigration: "20991231000100_spike_alpha_broken",
    brokenMigrationDir:
      "v2/modules/spike-alpha/prisma/migrations/20991231000100_spike_alpha_broken",
    brokenTable: "V2BrokenAlphaPartial",
  },
  beta: {
    moduleId: "spike-beta",
    config: "v2/modules/spike-beta/prisma.config.ts",
    table: "V2SpikeBeta",
    initialMigration: "20260831000200_spike_beta_initial",
    brokenMigration: "20991231000200_spike_beta_broken",
    brokenMigrationDir:
      "v2/modules/spike-beta/prisma/migrations/20991231000200_spike_beta_broken",
    brokenTable: "V2BrokenBetaPartial",
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

function runProcess(command, args, expectedSuccess, description) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
  });

  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");

  const succeeded = result.status === 0;
  if (succeeded !== expectedSuccess) {
    throw new Error(
      `${description} ${succeeded ? "succeeded" : "failed"}; expected ${expectedSuccess ? "success" : "failure"}`,
    );
  }
}

function validateModule(moduleName) {
  const moduleSpec = modules[moduleName];
  runProcess(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prisma", "validate", "--config", moduleSpec.config],
    true,
    `${moduleName} prisma validate`,
  );
}

function runCompositor(moduleName, expectedSuccess = true) {
  const moduleSpec = modules[moduleName];
  runProcess(
    process.execPath,
    ["v2/platform/persistence/migration-compositor.mjs", moduleSpec.moduleId],
    expectedSuccess,
    `${moduleName} migration compositor`,
  );
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

async function requireTableName(tableName, expected) {
  const present = await tableExists(tableName);
  if (present !== expected) {
    throw new Error(`${tableName} presence=${present}; expected ${expected}`);
  }
}

async function requireModuleTable(moduleName, expected) {
  await requireTableName(modules[moduleName].table, expected);
}

async function requireLedgerState(moduleName, migrationName, expectedState) {
  const moduleSpec = modules[moduleName];
  await withDatabase(async (client) => {
    const result = await client.query(
      `SELECT "state"
         FROM "_bke_module_migrations"
        WHERE "moduleId" = $1 AND "migrationName" = $2`,
      [moduleSpec.moduleId, migrationName],
    );

    const actualState = result.rows[0]?.state ?? null;
    if (actualState !== expectedState) {
      throw new Error(
        `${moduleSpec.moduleId}/${migrationName} state=${actualState}; expected ${expectedState}`,
      );
    }
  });
}

function injectBrokenMigration(moduleName) {
  const moduleSpec = modules[moduleName];
  mkdirSync(moduleSpec.brokenMigrationDir, { recursive: true });
  writeFileSync(
    `${moduleSpec.brokenMigrationDir}/migration.sql`,
    `CREATE TABLE "${moduleSpec.brokenTable}" ("id" TEXT NOT NULL);\nBROKEN SQL HERE;\n`,
    "utf8",
  );
}

async function proveBrokenMigrationLocality(brokenModule, healthyModule) {
  const broken = modules[brokenModule];
  const healthy = modules[healthyModule];

  runCompositor(healthyModule);
  await requireLedgerState(
    healthyModule,
    healthy.initialMigration,
    "APPLIED",
  );

  injectBrokenMigration(brokenModule);
  runCompositor(brokenModule, false);

  await requireLedgerState(
    brokenModule,
    broken.brokenMigration,
    "FAILED",
  );
  await requireModuleTable(healthyModule, true);
  await requireTableName(broken.brokenTable, false);

  // The failed module stays blocked until its own migration is explicitly resolved.
  runCompositor(brokenModule, false);

  // The unrelated module remains independently runnable despite that failure.
  runCompositor(healthyModule);
  await requireLedgerState(
    healthyModule,
    healthy.initialMigration,
    "APPLIED",
  );
  await requireModuleTable(healthyModule, true);
}

async function run() {
  validateModule("alpha");
  validateModule("beta");

  switch (scenario) {
    case "alpha-only":
      runCompositor("alpha");
      await requireModuleTable("alpha", true);
      await requireModuleTable("beta", false);
      break;

    case "beta-only":
      runCompositor("beta");
      await requireModuleTable("beta", true);
      await requireModuleTable("alpha", false);
      break;

    case "alpha-then-beta":
      runCompositor("alpha");
      runCompositor("beta");
      await requireModuleTable("alpha", true);
      await requireModuleTable("beta", true);
      break;

    case "beta-then-alpha":
      runCompositor("beta");
      runCompositor("alpha");
      await requireModuleTable("alpha", true);
      await requireModuleTable("beta", true);
      break;

    case "broken-alpha-locality":
      await proveBrokenMigrationLocality("alpha", "beta");
      break;

    case "broken-beta-locality":
      await proveBrokenMigrationLocality("beta", "alpha");
      break;
  }

  console.log(`V2 Prisma isolation scenario GREEN: ${scenario}`);
}

await run();
