import "server-only";
import { S3Client, GetObjectCommand, PutObjectCommand,DeleteObjectCommand,HeadBucketCommand,HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
function client(){if(!env.S3_ACCESS_KEY_ID||!env.S3_SECRET_ACCESS_KEY)throw new Error("STORAGE_NOT_CONFIGURED");return new S3Client({region:env.S3_REGION,endpoint:env.S3_ENDPOINT,forcePathStyle:env.S3_FORCE_PATH_STYLE,credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY}})}
function publicUploadClient(){if(!env.S3_ACCESS_KEY_ID||!env.S3_SECRET_ACCESS_KEY||!env.S3_PUBLIC_UPLOAD_ENDPOINT)throw new Error("DIRECT_UPLOAD_NOT_CONFIGURED");return new S3Client({region:env.S3_REGION,endpoint:env.S3_PUBLIC_UPLOAD_ENDPOINT,forcePathStyle:env.S3_FORCE_PATH_STYLE,credentials:{accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY}})}
export async function downloadObject(objectKey:string){const result=await client().send(new GetObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey}));if(!result.Body)throw new Error("OBJECT_NOT_FOUND");return result.Body.transformToByteArray()}
export async function uploadObject(objectKey:string,body:Uint8Array,contentType:string){await client().send(new PutObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey,Body:body,ContentType:contentType,ServerSideEncryption:env.S3_ENDPOINT?undefined:"AES256"}))}
export async function headObject(objectKey:string){return client().send(new HeadObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey}));}
export async function assertObjectExists(objectKey:string){await headObject(objectKey);}
export async function createArtifactUploadUrl(objectKey:string,contentType:string,contentLength:number,expiresIn=600){const command=new PutObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey,ContentType:contentType,ContentLength:contentLength});return getSignedUrl(publicUploadClient(),command,{expiresIn})}
export async function deleteObject(objectKey:string){await client().send(new DeleteObjectCommand({Bucket:env.S3_BUCKET,Key:objectKey}))}
export async function checkStorageReadiness(signal?:AbortSignal){await client().send(new HeadBucketCommand({Bucket:env.S3_BUCKET}),{abortSignal:signal})}
