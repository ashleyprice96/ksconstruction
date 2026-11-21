import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { storageDriver } from "./object-store";
import { isRemoteKey, remoteStore } from "./remote-file";
import { activeObjectStore } from "./storage-s3";

// Disk storage for the postgres driver. When STORAGE_DRIVER=s3, bytes go to a
// private bucket and the app reads them back after its own auth check.

const root = () => resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR || "./uploads");

const ALLOWED = new Map([
  ["image/jpeg", "jpg"], ["image/png", "png"], ["image/webp", "webp"],
  ["image/heic", "heic"], ["application/pdf", "pdf"],
]);
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function checkFile(f: File, allowPdf: boolean): string | null {
  if (!f || f.size === 0) return "No file selected.";
  if (f.size > MAX_FILE_BYTES) return "File is larger than 15 MB.";
  if (!ALLOWED.has(f.type) || (!allowPdf && f.type === "application/pdf")) return "That file type is not accepted.";
  return null;
}

export function objectKey(mime: string): string {
  const ext = ALLOWED.get(mime) ?? "bin";
  return `files/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
}

export async function saveFile(data: Buffer, mime: string): Promise<string> {
  if (storageDriver() === "vercel-blob") {
    const key = `blob/${objectKey(mime)}`;
    await remoteStore(key).put(key, data, mime);
    return key;
  }
  if (storageDriver() === "s3") {
    const key = objectKey(mime);
    const store = await activeObjectStore();
    if (!store) throw new Error("S3 storage is not configured.");
    await store.put(key, data, mime);
    return key;
  }
  const ext = ALLOWED.get(mime) ?? "bin";
  const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  await mkdir(join(/*turbopackIgnore: true*/ root(), key.slice(0, 7)), { recursive: true });
  await writeFile(join(/*turbopackIgnore: true*/ root(), key), data);
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  if (isRemoteKey(key)) {
    const body = await remoteStore(key).get(key);
    if (!body) throw new Error("missing object");
    return body;
  }
  if (!/^\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z]+$/.test(key)) throw new Error("bad key");
  return readFile(join(/*turbopackIgnore: true*/ root(), key));
}
