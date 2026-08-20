import { NextResponse } from "next/server";
import { z } from "zod";
import { createPrivateKey, sign } from "node:crypto";
import { db } from "@/lib/db";
import { hashLicenseKey, hashToken, randomToken } from "@/lib/security/crypto";
import { resolveCurrentCustomerRelease } from "@/lib/releases/resolution";
import { activeCommercialSigningKey, ensureCommercialSigningKey } from "@/lib/licensing/signing-registry";

const requestSchema=z.object({license_key:z.string().min(8).max(512),product_id:z.string().min(1).max(128),current_version:z.string().min(1).max(64),platform:z.string().min(1).max(64),architecture:z.string().min(1).max(64),channel:z.enum(["stable","lts"]).default("stable")});
function canonical(value:Record<string,unknown>) { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left],[right]) => left < right ? -1 : left > right ? 1 : 0))); }
function major(version:string):number { const match=/^(\d+)/.exec(version); if(!match) throw new Error("invalid version"); return Number(match[1]); }

export async function POST(request:Request) {
  try {
    const input=requestSchema.parse(await request.json());
    const license=await db.license.findFirst({where:{keyHash:hashLicenseKey(input.license_key),productId:input.product_id,status:"ACTIVE",account:{lifecycleState:"ACTIVE"}},include:{edition:true,purchasePlan:true,subscription:true}});
    if(!license || (license.expiresAt && license.expiresAt<new Date())) return NextResponse.json({error:"NOT_ENTITLED"},{status:403});
    const updatePolicy=license.edition?.updatePolicy ?? "LIFETIME";
    if(updatePolicy==="ACTIVE_TERM" && (!license.expiresAt || license.expiresAt<new Date() || (license.subscription && license.subscription.status!=="ACTIVE"))) return NextResponse.json({error:"UPDATE_NOT_ENTITLED"},{status:403});
    const release=await resolveCurrentCustomerRelease(input.product_id);
    const compatible=release && release.operatingSystem.toLowerCase()===input.platform.toLowerCase() && release.architecture.toLowerCase()===input.architecture.toLowerCase() && ((input.channel==="lts" && release.lifecycle==="LTS") || (input.channel==="stable" && release.channel==="STABLE" && release.lifecycle==="STABLE"));
    if(!compatible) return NextResponse.json({error:"NO_ELIGIBLE_RELEASE"},{status:404});
    if(updatePolicy==="MAJOR_VERSION" && major(input.current_version)!==major(release.version)) return NextResponse.json({error:"UPDATE_NOT_ENTITLED"},{status:403});
    const artifact=release.artifacts.find(item=>item.active && !item.removedAt && item.sha256 && Number(item.sizeBytes)>=0);
    if(!artifact) return NextResponse.json({error:"ARTIFACT_UNAVAILABLE"},{status:503});
    await ensureCommercialSigningKey(); const key=await activeCommercialSigningKey();
    const policy={schema:"bke.update-policy.v1",product_id:input.product_id,current_version:input.current_version,latest_version:release.version,minimum_supported_version:release.minimumSupportedVersion ?? release.version,channel:input.channel,platform:release.operatingSystem,architecture:release.architecture,release_id:release.id,artifact_id:artifact.id,artifact_sha256:artifact.sha256.toLowerCase(),artifact_size:Number(artifact.sizeBytes),content_type:artifact.contentType,published_at:release.publishedAt?.toISOString(),issued_at:new Date().toISOString(),revision:release.releasedAt.getTime(),signing_key_id:key.keyId,algorithm:"Ed25519"};
    if(Object.values(policy).some(value=>value===undefined) || policy.artifact_size<0 || !/^[0-9a-f]{64}$/.test(policy.artifact_sha256) || major(policy.minimum_supported_version)>major(policy.latest_version)) return NextResponse.json({error:"POLICY_GENERATION_FAILED"},{status:500});
    const signature=sign(null,Buffer.from(canonical(policy)),createPrivateKey(key.privateKey)).toString("base64");
    const token=randomToken();
    await db.downloadGrant.create({data:{licenseId:license.id,artifactId:artifact.id,tokenHash:hashToken(token),expiresAt:new Date(Date.now()+60_000)}});
    return NextResponse.json({policy:{...policy,signature},download_url:new URL("/api/downloads/grants/"+token,process.env.APP_URL).toString()});
  } catch(error) {
    const code=error instanceof Error && error.name==="ZodError" ? "INVALID_REQUEST" : "POLICY_GENERATION_FAILED";
    return NextResponse.json({error:code},{status:code==="INVALID_REQUEST"?400:500});
  }
}
