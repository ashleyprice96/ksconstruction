import { del, get, head, list, put } from "@vercel/blob";
import { sha256 } from "./sign-off";
import type { ObjectStore } from "./object-store";

const ACCESS = "private" as const;

function token(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN;
  if (!value) throw new Error("Vercel Blob needs BLOB_READ_WRITE_TOKEN.");
  return value;
}

/** Private Blob store. Reads use the server token. The URL is not given to the browser. */
export function blobObjectStore(): ObjectStore {
  return {
    async put(key, body, contentType) {
      await put(key, body, { access: ACCESS, token: token(), contentType, addRandomSuffix: false, allowOverwrite: true });
    },
    async get(key, range) {
      const result = await get(key, {
        access: ACCESS,
        token: token(),
        headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined,
      });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
      if (!range) return buf;
      const want = range.end - range.start + 1;
      if (buf.length === want) return buf;
      if (buf.length > range.end) return buf.subarray(range.start, range.end + 1);
      return buf;
    },
    async head(key) {
      try {
        const meta = await head(key, { token: token() });
        return meta.size;
      } catch {
        return null;
      }
    },
    async delete(key) {
      await del(key, { token: token() });
    },
    async totalBytes() {
      let total = 0;
      let cursor: string | undefined;
      do {
        const page = await list({ token: token(), cursor, limit: 1000 });
        for (const blob of page.blobs) total += blob.size;
        if (!page.hasMore || !page.cursor) break;
        cursor = page.cursor;
      } while (cursor);
      return total;
    },
  };
}

/** Download a private blob the browser just uploaded, and check its hash. */
export async function loadPrivateUpload(pathname: string, expectedSha: string, maxBytes: number): Promise<{ bytes: Buffer; hash: string; type: string }> {
  if (!pathname.startsWith("blob/") || pathname.includes("..") || pathname.includes("://")) {
    throw new Error("That file is not in the upload store.");
  }
  const result = await get(pathname, { access: ACCESS, token: token() });
  if (!result || result.statusCode !== 200 || !result.stream) throw new Error("The uploaded file could not be read.");
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) throw new Error("The file is too large.");
  const hash = sha256(bytes);
  if (expectedSha && expectedSha !== hash) throw new Error("The uploaded file did not match. Upload it again.");
  return { bytes, hash, type: result.blob.contentType || "application/octet-stream" };
}
