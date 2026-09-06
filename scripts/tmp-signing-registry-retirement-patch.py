from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1))

# Adopt immutable @bke/licensing 0.7.0.
replace_once(
    "package.json",
    '"@bke/licensing": "https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.6.0/bke-licensing-0.6.0.tgz"',
    '"@bke/licensing": "https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.7.0/bke-licensing-0.7.0.tgz"',
)

# Register the new Licensing-owned signing-key registry capability.
path = "v2/modules/licensing/module.ts"
replace_once(
    path,
    'import { LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID } from "@bke/licensing/contracts/license-key-reveal.contract";',
    'import { LICENSING_LICENSE_KEY_REVEAL_CAPABILITY_ID } from "@bke/licensing/contracts/license-key-reveal.contract";\nimport { LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID } from "@bke/licensing/contracts/signing-key-registry.contract";',
)
replace_once(
    path,
    'import { createPostgresLicensingLicenseLookupRepository } from "@bke/licensing/prisma/repositories/postgres-license-lookup-repository";\nimport { createPostgresLicensingTransferPolicyCapability } from "@bke/licensing/prisma/repositories/postgres-transfer-policy-repository";',
    'import { createPostgresLicensingLicenseLookupRepository } from "@bke/licensing/prisma/repositories/postgres-license-lookup-repository";\nimport { createPostgresLicensingSigningKeyRegistryCapability } from "@bke/licensing/prisma/repositories/postgres-signing-key-registry-repository";\nimport { createPostgresLicensingTransferPolicyCapability } from "@bke/licensing/prisma/repositories/postgres-transfer-policy-repository";',
)
replace_once(
    path,
    '  const signer = createEd25519CommercialLeaseSigner({\n    resolve: resolveCommercialPrivateKey,\n  });\n  const transferPolicy = createPostgresLicensingTransferPolicyCapability(options.connectionString);',
    '  const signer = createEd25519CommercialLeaseSigner({\n    resolve: resolveCommercialPrivateKey,\n  });\n  const signingKeyRegistry = createPostgresLicensingSigningKeyRegistryCapability(\n    options.connectionString,\n    commercialSigningBootstrap(),\n  );\n  const transferPolicy = createPostgresLicensingTransferPolicyCapability(options.connectionString);',
)
replace_once(
    path,
    '        {\n          id: LICENSING_TRANSFER_POLICY_CAPABILITY_ID,\n          value: transferPolicy,\n        },',
    '        {\n          id: LICENSING_TRANSFER_POLICY_CAPABILITY_ID,\n          value: transferPolicy,\n        },\n        {\n          id: LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID,\n          value: signingKeyRegistry,\n        },',
)

# Thin host adapter: capability resolution only; no Licensing SQL/policy.
adapter = Path("v2/apps/web/licensing/signing-key-registry.ts")
adapter.parent.mkdir(parents=True, exist_ok=True)
adapter.write_text('''import "server-only";\n\nimport {\n  LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID,\n  type LicensingSigningKeyRegistryCapability,\n} from "@bke/licensing/contracts/signing-key-registry.contract";\nimport { getV2WebApplication } from "../runtime";\n\nasync function signingKeyRegistry(): Promise<LicensingSigningKeyRegistryCapability> {\n  const application = await getV2WebApplication();\n  return application.get<LicensingSigningKeyRegistryCapability>(\n    LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID,\n  );\n}\n\nexport async function ensureLicensingSigningKey(): Promise<void> {\n  await (await signingKeyRegistry()).ensure();\n}\n\nexport async function activeLicensingSigningKey() {\n  return (await signingKeyRegistry()).active();\n}\n\nexport async function listPublicLicensingSigningKeys() {\n  return (await signingKeyRegistry()).listPublic();\n}\n''')

# Public key route: consume the module-owned public registry instead of foreign-domain SQL.
keys_route = Path("app/api/licensing/keys/route.ts")
keys_route.write_text('''import { NextResponse } from "next/server";\nimport { canonicalizePublicKey } from "@/lib/security/crypto";\nimport {\n  ensureLicensingSigningKey,\n  listPublicLicensingSigningKeys,\n} from "@/v2/apps/web/licensing/signing-key-registry";\n\nexport async function GET() {\n  try {\n    await ensureLicensingSigningKey();\n    const records = await listPublicLicensingSigningKeys();\n    const active = records.filter((record) => record.status === "ACTIVE");\n    if (active.length !== 1) throw new Error("ACTIVE_SIGNING_KEY_COUNT_INVALID");\n    if (records.some((record) => record.algorithm !== "Ed25519")) throw new Error("UNSUPPORTED_SIGNING_ALGORITHM");\n    return NextResponse.json(\n      {\n        algorithm: "Ed25519",\n        activeKeyId: active[0]!.keyId,\n        publicKeys: Object.fromEntries(\n          records.map((record) => [record.keyId, canonicalizePublicKey(record.publicKey)]),\n        ),\n      },\n      { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=300" } },\n    );\n  } catch {\n    return NextResponse.json({ error: "SIGNING_KEYS_UNAVAILABLE" }, { status: 503 });\n  }\n}\n''')

# Refresh route: use the released registry capability for signer identity.
path = "app/api/licenses/refresh/route.ts"
replace_once(
    path,
    'import { activeCommercialSigningKey } from "@/lib/licensing/signing-registry";',
    'import { activeLicensingSigningKey } from "@/v2/apps/web/licensing/signing-key-registry";',
)
replace_once(path, 'const signingKey = await activeCommercialSigningKey();', 'const signingKey = await activeLicensingSigningKey();')

# Consumer certification: pin 0.7.0 and prove the real host adoption / V1 retirement.
path = "v2/modules/licensing/test/consumer-adoption.certify.ts"
replace_once(
    path,
    'https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.6.0/bke-licensing-0.6.0.tgz";\nconst EXPECTED_VERSION = "0.6.0";',
    'https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.7.0/bke-licensing-0.7.0.tgz";\nconst EXPECTED_VERSION = "0.7.0";',
)
replace_once(
    path,
    '  "LICENSING_TRANSFER_POLICY_CAPABILITY_ID",\n  "@bke/licensing/logic/",',
    '  "LICENSING_TRANSFER_POLICY_CAPABILITY_ID",\n  "LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID",\n  "@bke/licensing/logic/",',
)
replace_once(
    path,
    '  "createPostgresCommercialSigningKeyProvider",\n  "@bke/licensing/prisma/repositories/postgres-license-lookup-repository",',
    '  "createPostgresCommercialSigningKeyProvider",\n  "@bke/licensing/prisma/repositories/postgres-signing-key-registry-repository",\n  "createPostgresLicensingSigningKeyRegistryCapability",\n  "@bke/licensing/prisma/repositories/postgres-license-lookup-repository",',
)
replace_once(
    path,
    '  migrationCompositorSource,\n] = await Promise.all([',
    '  migrationCompositorSource,\n  signingRegistryHostSource,\n  signingKeysRouteSource,\n  refreshRouteSource,\n] = await Promise.all([',
)
replace_once(
    path,
    '  readFile(\n    new URL("../../../platform/persistence/migration-compositor.mjs", import.meta.url),\n    "utf8",\n  ),\n]);',
    '  readFile(\n    new URL("../../../platform/persistence/migration-compositor.mjs", import.meta.url),\n    "utf8",\n  ),\n  readFile(new URL("../../../apps/web/licensing/signing-key-registry.ts", import.meta.url), "utf8"),\n  readFile(new URL("../../../../app/api/licensing/keys/route.ts", import.meta.url), "utf8"),\n  readFile(new URL("../../../../app/api/licenses/refresh/route.ts", import.meta.url), "utf8"),\n]);',
)
replace_once(
    path,
    'if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {\n  throw new Error(\n    "The migration compositor must support module-owned external migration roots.",\n  );\n}\n',
    'if (!migrationCompositorSource.includes("configuredMigrationsRoot")) {\n  throw new Error(\n    "The migration compositor must support module-owned external migration roots.",\n  );\n}\n\nfor (const marker of [\n  "LICENSING_SIGNING_KEY_REGISTRY_CAPABILITY_ID",\n  "ensureLicensingSigningKey",\n  "activeLicensingSigningKey",\n  "listPublicLicensingSigningKeys",\n]) {\n  if (!signingRegistryHostSource.includes(marker)) {\n    throw new Error(`Licensing signing-key host adapter missing capability surface: ${marker}`);\n  }\n}\nfor (const [name, source] of [["keys", signingKeysRouteSource], ["refresh", refreshRouteSource]] as const) {\n  if (source.includes("@/lib/licensing/signing-registry")) {\n    throw new Error(`${name} route still reaches through to V1 signing registry.`);\n  }\n  if (!source.includes("@/v2/apps/web/licensing/signing-key-registry")) {\n    throw new Error(`${name} route does not consume the V2 signing-key registry adapter.`);\n  }\n}\n',
)

# Focused workflow: certify the immutable artifact and trigger on both retired importers/adapter.
path = ".github/workflows/v2-licensing.yml"
replace_once(path, '      - "app/api/licenses/refresh/route.ts"', '      - "app/api/licenses/refresh/route.ts"\n      - "app/api/licensing/keys/route.ts"\n      - "v2/apps/web/licensing/signing-key-registry.ts"')
replace_once(
    path,
    'artifact=/tmp/bke-licensing-0.6.0.tgz\n          curl -fL --retry 3 --retry-all-errors \\\n            -o "$artifact" \\\n            https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.6.0/bke-licensing-0.6.0.tgz\n          echo "188ced2d76f76bc722dab8dca6c9ab5d0a193789a7d6a4b4f979eac0c0d92ee5  $artifact" | sha256sum -c -',
    'artifact=/tmp/bke-licensing-0.7.0.tgz\n          curl -fL --retry 3 --retry-all-errors \\\n            -o "$artifact" \\\n            https://github.com/jan2xo/bke-libraries-typescript/releases/download/licensing-v0.7.0/bke-licensing-0.7.0.tgz\n          echo "0e5b8495acba7d462064114c122d395eeb544ea2d40f2e8d89e0678b7027f19a  $artifact" | sha256sum -c -',
)

print("Digital signing-registry retirement patch applied")
