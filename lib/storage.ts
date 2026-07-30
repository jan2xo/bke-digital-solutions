import "server-only";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";
function client(){if(!env.S3_ACCESS_KEY_ID||!env.S3_SECRET_ACCESS_KEY)throw new Error("STORAGE_NOT_CONFIGURED");return new S3Client({region:env.S3_REGION,endpoint:env.S3_ENDPOINT,forcePathStyle:Boolean(env.S3_ENDPOINT),credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY}})}
export async function downloadObject(objectKey:string){const result=await client().send(new GetObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey}));if(!result.Body)throw new Error("OBJECT_NOT_FOUND");return result.Body.transformToByteArray()}
export async function uploadObject(objectKey:string,body:Uint8Array,contentType:string){await client().send(new PutObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey,Body:body,ContentType:contentType,ServerSideEncryption:env.S3_ENDPOINT?undefined:"AES256"}))}
