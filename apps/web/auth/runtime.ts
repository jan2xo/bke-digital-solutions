import "server-only";
import type { ComposedApplication } from "@/contracts/capability";
import { createIdentityModule } from "@/modules/identity/module";
import { composeCapabilities } from "@/platform/composition/composer";

const runtime = globalThis as unknown as { bkeGoogleIdentityApplication?: Promise<ComposedApplication> };

/** Sign-in has no payment, outbound email, artifact or licensing-provider startup dependency. */
export function getIdentityWebApplication(): Promise<ComposedApplication> {
  if (!runtime.bkeGoogleIdentityApplication) {
    const connectionString = process.env.DATABASE_URL?.trim();
    const sessionSecret = process.env.SESSION_SECRET?.trim();
    if (!connectionString || !sessionSecret || sessionSecret.length < 32) {
      throw new Error("IDENTITY_CONFIGURATION_UNAVAILABLE");
    }
    runtime.bkeGoogleIdentityApplication = composeCapabilities([
      createIdentityModule({ connectionString, sessionSecret }),
    ]).catch((error) => {
      delete runtime.bkeGoogleIdentityApplication;
      throw error;
    });
  }
  return runtime.bkeGoogleIdentityApplication;
}
