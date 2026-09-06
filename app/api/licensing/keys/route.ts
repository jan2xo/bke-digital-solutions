import { NextResponse } from "next/server";
import { canonicalizePublicKey } from "@/lib/security/crypto";
import {
  ensureLicensingSigningKey,
  listPublicLicensingSigningKeys,
} from "@/v2/apps/web/licensing/signing-key-registry";

export async function GET() {
  try {
    await ensureLicensingSigningKey();
    const records = await listPublicLicensingSigningKeys();
    const active = records.filter((record) => record.status === "ACTIVE");
    if (active.length !== 1) throw new Error("ACTIVE_SIGNING_KEY_COUNT_INVALID");
    if (records.some((record) => record.algorithm !== "Ed25519")) throw new Error("UNSUPPORTED_SIGNING_ALGORITHM");
    return NextResponse.json(
      {
        algorithm: "Ed25519",
        activeKeyId: active[0]!.keyId,
        publicKeys: Object.fromEntries(
          records.map((record) => [record.keyId, canonicalizePublicKey(record.publicKey)]),
        ),
      },
      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=300" } },
    );
  } catch {
    return NextResponse.json({ error: "SIGNING_KEYS_UNAVAILABLE" }, { status: 503 });
  }
}
