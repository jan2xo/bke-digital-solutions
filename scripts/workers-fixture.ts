import { readFile, writeFile } from "node:fs/promises";
import { db } from "../platform/host/db";
import { getV2WebApplication } from "../apps/web/runtime";
import { registrationLegalDocuments, recordLegalAcceptances } from "../apps/web/legal/service";
import { REGISTRATION_LEGAL_TYPES } from "@bke/legal/logic/document-catalog";
import {
  IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID,
  type IdentitySessionIssuanceCapability,
} from "@bke/identity/contracts/session.contract";

const database = new URL(process.env.DATABASE_URL ?? "");
if (process.env.GITHUB_ACTIONS !== "true" || database.pathname !== "/bke_test") {
  throw new Error("Workers fixtures require the isolated Actions bke_test database");
}
const path = ".certification-secrets/workers-sessions.json";
try {
  if (process.argv[2] === "revoke") {
    const sessions: { sessionId: string }[] = JSON.parse(await readFile(path, "utf8"));
    await db.session.update({ where: { id: sessions[0]!.sessionId }, data: { revokedAt: new Date() } });
  } else {
    const legal = await registrationLegalDocuments();
    const ids = legal.map((entry) => entry.currentPublishedVersionId);
    if (ids.length !== 2 || ids.some((id) => !id)) throw new Error("Published registration legal fixtures missing");
    const application = await getV2WebApplication();
    const issuance = application.get<IdentitySessionIssuanceCapability>(IDENTITY_SESSION_ISSUANCE_CAPABILITY_ID);
    const sessions = [];
    for (const name of ["Worker Alpha", "Worker Beta"]) {
      const user = await db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: name.replaceAll(" ", ".").toLowerCase() + "@example.invalid", name, emailVerified: new Date(),
            ownedAccounts: { create: { type: "INDIVIDUAL", displayName: name + " account", billingEmail: "billing@example.invalid" } } },
          include: { ownedAccounts: true },
        });
        await recordLegalAcceptances(tx, {
          userId: created.id, customerAccountId: created.ownedAccounts[0]!.id,
          types: [...REGISTRATION_LEGAL_TYPES], selectedVersionIds: ids as string[],
          context: "REGISTRATION", request: new Request("https://workers-ci.example.invalid/register"),
        });
        return created;
      });
      const issued = await issuance.issue({ userId: user.id, authenticationMethod: "GOOGLE_OIDC" });
      if (!("token" in issued)) throw new Error("Fixture session issuance failed");
      sessions.push({ name, token: issued.token, sessionId: issued.session.id });
    }
    await writeFile(path, JSON.stringify(sessions), { mode: 0o600 });
  }
} finally {
  await db.$disconnect();
}
