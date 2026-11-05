import "server-only";
import type { ComposedApplication } from "@/contracts/capability";
import { createIdentityModule } from "@/modules/identity/module";
import { composeCapabilities } from "@/platform/composition/composer";
import { currentOperationDatabaseUrl, operationResource } from "@/platform/host/operation-scope";

const runtime = globalThis as unknown as { bkeGoogleIdentityApplication?: Promise<ComposedApplication> };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing identity configuration: ${name}`);
  return value;
}

function composeIdentityApplication(): Promise<ComposedApplication> {
  const connectionString = currentOperationDatabaseUrl() ?? required("DATABASE_URL");
  const sessionSecret = required("SESSION_SECRET");
  if (sessionSecret.length < 32) throw new Error("IDENTITY_CONFIGURATION_UNAVAILABLE");
  return composeCapabilities([
    createIdentityModule({ connectionString, sessionSecret }),
  ]);
}

/** Sign-in has no payment, outbound email, artifact or licensing-provider startup dependency. */
export function getIdentityWebApplication(): Promise<ComposedApplication> {
  if (currentOperationDatabaseUrl()) {
    return operationResource("identity-auth-application", composeIdentityApplication);
  }
  if (process.env.BKE_RUNTIME === "workers") throw new Error("WORKER_OPERATION_SCOPE_REQUIRED");
  if (!runtime.bkeGoogleIdentityApplication) {
    runtime.bkeGoogleIdentityApplication = composeIdentityApplication().catch((error) => {
      delete runtime.bkeGoogleIdentityApplication;
      throw error;
    });
  }
  return runtime.bkeGoogleIdentityApplication;
}
