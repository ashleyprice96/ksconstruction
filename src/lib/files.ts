import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// Local disk storage for development. Swap for private object storage (UK region)
// in production; the rest of the app only uses saveFile and readStoredFile.

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

export async function saveFile(data: Buffer, mime: string): Promise<string> {
  const ext = ALLOWED.get(mime) ?? "bin";
  const key = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
  await mkdir(join(/*turbopackIgnore: true*/ root(), key.slice(0, 7)), { recursive: true });
  await writeFile(join(/*turbopackIgnore: true*/ root(), key), data);
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  if (!/^\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z]+$/.test(key)) throw new Error("bad key");
  return readFile(join(/*turbopackIgnore: true*/ root(), key));
}
