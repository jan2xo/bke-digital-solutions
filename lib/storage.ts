import "server-only";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
function client(){if(!env.S3_ACCESS_KEY_ID||!env.S3_SECRET_ACCESS_KEY)throw new Error("STORAGE_NOT_CONFIGURED");return new S3Client({region:env.S3_REGION,endpoint:env.S3_ENDPOINT,forcePathStyle:Boolean(env.S3_ENDPOINT),credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY}})}
export async function signedDownload(objectKey:string,filename:string){const safe=filename.replace(/[^a-zA-Z0-9._-]/g,"_");return getSignedUrl(client(),new GetObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey,ResponseContentDisposition:`attachment; filename="${safe}"`}),{expiresIn:60})}
