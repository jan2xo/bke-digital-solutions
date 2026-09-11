import "server-only";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getObjectStorageEnvironment, type ObjectStorageEnvironment } from "@/v2/apps/web/config/environment";

function client(environment: ObjectStorageEnvironment) {
  if (!environment.accessKeyId || !environment.secretAccessKey) throw new Error("STORAGE_NOT_CONFIGURED");
  return new S3Client({
    region: environment.region,
    endpoint: environment.endpoint,
    forcePathStyle: environment.forcePathStyle,
    credentials: { accessKeyId: environment.accessKeyId, secretAccessKey: environment.secretAccessKey },
  });
}

function publicUploadClient(environment: ObjectStorageEnvironment) {
  if (!environment.accessKeyId || !environment.secretAccessKey || !environment.publicUploadEndpoint) throw new Error("DIRECT_UPLOAD_NOT_CONFIGURED");
  return new S3Client({
    region: environment.region,
    endpoint: environment.publicUploadEndpoint,
    forcePathStyle: environment.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: { accessKeyId: environment.accessKeyId, secretAccessKey: environment.secretAccessKey },
  });
}

export async function downloadObject(objectKey: string) {
  const environment = getObjectStorageEnvironment();
  const result = await client(environment).send(new GetObjectCommand({ Bucket: environment.bucket, Key: objectKey }));
  if (!result.Body) throw new Error("OBJECT_NOT_FOUND");
  return result.Body.transformToByteArray();
}

export async function streamObject(objectKey: string): Promise<AsyncIterable<Uint8Array>> {
  const environment = getObjectStorageEnvironment();
  const result = await client(environment).send(new GetObjectCommand({ Bucket: environment.bucket, Key: objectKey }));
  if (!result.Body) throw new Error("OBJECT_NOT_FOUND");
  return result.Body as AsyncIterable<Uint8Array>;
}

export async function uploadObject(objectKey: string, body: Uint8Array, contentType: string) {
  const environment = getObjectStorageEnvironment();
  await client(environment).send(new PutObjectCommand({
    Bucket: environment.bucket,
    Key: objectKey,
    Body: body,
    ContentType: contentType,
    ServerSideEncryption: environment.endpoint ? undefined : "AES256",
  }));
}

export async function headObject(objectKey: string) {
  const environment = getObjectStorageEnvironment();
  return client(environment).send(new HeadObjectCommand({ Bucket: environment.bucket, Key: objectKey }));
}

export async function assertObjectExists(objectKey: string) {
  await headObject(objectKey);
}

export async function createArtifactUploadUrl(
  objectKey: string,
  contentType: string,
  contentLength: number,
  expiresIn = 600,
) {
  if (!Number.isInteger(contentLength) || contentLength < 1) throw new Error("INVALID_UPLOAD_LENGTH");
  if (!Number.isInteger(expiresIn) || expiresIn < 60 || expiresIn > 900) throw new Error("INVALID_UPLOAD_EXPIRY");
  const environment = getObjectStorageEnvironment();
  const command = new PutObjectCommand({
    Bucket: environment.bucket,
    Key: objectKey,
    ContentType: contentType,
  });
  return getSignedUrl(publicUploadClient(environment), command, { expiresIn });
}

export async function createDirectUploadUrl(objectKey: string, contentType: string, expiresInSeconds = 600) {
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 900) throw new Error("INVALID_UPLOAD_EXPIRY");
  const environment = getObjectStorageEnvironment();
  return getSignedUrl(publicUploadClient(environment), new PutObjectCommand({
    Bucket: environment.bucket,
    Key: objectKey,
    ContentType: contentType,
  }), { expiresIn: expiresInSeconds });
}

export async function deleteObject(objectKey: string) {
  const environment = getObjectStorageEnvironment();
  await client(environment).send(new DeleteObjectCommand({ Bucket: environment.bucket, Key: objectKey }));
}

export async function checkStorageReadiness(signal?: AbortSignal) {
  const environment = getObjectStorageEnvironment();
  await client(environment).send(new HeadBucketCommand({ Bucket: environment.bucket }), { abortSignal: signal });
}
