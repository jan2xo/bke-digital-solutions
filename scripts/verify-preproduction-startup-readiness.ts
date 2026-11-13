import "dotenv/config";
import { Client } from "pg";
import { parseEnvironment } from "../platform/host/config/environment";
import {
  verifyPreproductionStartupTarget,
  auditPreproductionStartupReadiness,
} from "./preproduction-startup-readiness";

/**
 * Operator-invoked PREPRODUCTION READ ONLY audit.
 * Nothing is applied, enrolled, issued, signed, enabled or activated here.
 * Never print SQL, connection strings, machine identifiers, or signing keys.
 */
async function main() {
  let client: Client | undefined;
  let connected = false;
  let transaction = false;
  try {
    const target = verifyPreproductionStartupTarget(process.env);
    // The production runtime's full environment rules are also enforced:
    // distributed rate limiter, isolated staging deployment ID, server keys.
    parseEnvironment(process.env);

    client = new Client({
      connectionString: target.directDatabaseUrl,
      connectionTimeoutMillis: 5_000,
      query_timeout: 8_000,
      statement_timeout: 8_000,
      application_name: "bke_preproduction_startup_readiness",
    });
    await client.connect();
    connected = true;
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    // The scanner owns NO database mutation or migration-apply code paths.
    const proof = await auditPreproductionStartupReadiness({
      query: <T extends Record<string, unknown>>(
        statement: string, params?: unknown[],
      ) => client!.query<T>(statement, params),
    }, process.env);
    await client.query("ROLLBACK");
    transaction = false;
    console.info(
      "PREPRODUCTION_STARTUP_SQL_READINESS_PASS " +
      "official_migrations=" + proof.officialMigrationCount +
      " mode=" + proof.productMode +
      " machine_algorithm=" + proof.reviewedMachineAlgorithm +
      " human_approval=NOT_PROVEN installed_grant=NOT_PROVEN",
    );
  } catch (error) {
    // Deliberately never emit PG connection/SQL errors or invalid key material.
    const reason = error instanceof Error &&
      /^STARTUP_READINESS_[A-Z0-9_]+$/.test(error.message)
      ? error.message : "STARTUP_READINESS_UNAVAILABLE";
    console.error(reason + " (read-only; no authority promoted)");
    process.exitCode = 1;
  } finally {
    if (client && connected) {
      if (transaction) {
        try { await client.query("ROLLBACK"); } catch { /* read only */ }
      }
      try { await client.end(); } catch { /* no secret output */ }
    }
  }
}
void main();
