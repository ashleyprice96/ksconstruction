import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { copyVerified, storageDriver, type ObjectStore } from "./object-store";

export function s3Config() {
  const endpoint = process.env.S3_ENDPOINT ?? "";
  const bucket = process.env.S3_BUCKET ?? "";
  const region = process.env.S3_REGION || "auto";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 storage needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
  }
  return { endpoint, bucket, region, accessKeyId, secretAccessKey };
}

export function s3ObjectStore(): ObjectStore {
  const cfg = s3Config();
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const bucket = cfg.bucket;
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key, range) {
      const out = await client.send(new GetObjectCommand({
        Bucket: bucket, Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }));
      const bytes = await out.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    },
    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return out.ContentLength ?? null;
      } catch { return null; }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async totalBytes() {
      let total = 0;
      let token: string | undefined;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
        for (const item of page.Contents ?? []) total += item.Size ?? 0;
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return total;
    },
  };
}

export async function activeObjectStore(): Promise<ObjectStore | null> {
  if (storageDriver() !== "s3") return null;
  return s3ObjectStore();
}

export { copyVerified };
