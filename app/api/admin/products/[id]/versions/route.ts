import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security/request";

const fields = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/), releaseNotes: z.string().max(10000).default(""), operatingSystem: z.enum(["Windows", "macOS", "Linux"]), architecture: z.enum(["x64", "arm64", "universal"]) }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    const input = fields.parse(await request.json());
    const admin = await requireAdmin();
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new Error("NOT_FOUND");
    const version = await db.$transaction(async (tx) => tx.productVersion.create({ data: { productId: id, version: input.version, releaseNotes: input.releaseNotes, operatingSystem: input.operatingSystem, architecture: input.architecture, lifecycle: "DRAFT", active: false, publishedAt: null, isLatest: false } }));
    await db.supplyChainEvidence.create({ data: { versionId: version.id, releaseIdentifier: `${product.slug}@${version.version}`, commitHash: process.env.GIT_COMMIT ?? "unknown", branch: process.env.GIT_BRANCH ?? "unknown", buildEnvironment: process.env.BUILD_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown", builderIdentity: process.env.BUILDER_IDENTITY ?? "unidentified", builtAt: new Date(), manifestJson: { artifacts: [] }, dependencyVerified: Boolean(process.env.LOCKFILE_VERIFIED === "true") } });
    await audit({ actorId: admin.id, action: "PRODUCT_VERSION_CREATED", targetType: "ProductVersion", targetId: version.id, metadata: { productId: id, version: input.version, operatingSystem: input.operatingSystem, architecture: input.architecture, uploadRequired: true } });
    return NextResponse.json({ id: version.id, version: version.version, uploadRequired: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
