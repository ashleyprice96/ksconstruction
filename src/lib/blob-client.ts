"use client";

import { upload } from "@vercel/blob/client";

export type BlobPurpose = "hs" | "rams" | "topsheet" | "share";

export async function fileSha256(file: File): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Send a file straight to private Blob. The function only receives the pathname afterwards. */
export async function uploadPrivateBlob(file: File, purpose: BlobPurpose, onProgress?: (pct: number) => void) {
  const folder = purpose === "rams" ? "blob/rams" : purpose === "topsheet" ? "blob/topsheet" : purpose === "share" ? "blob/share" : "blob/hs";
  const safe = (file.name || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
  const sha256 = await fileSha256(file);
  const blob = await upload(`${folder}/${safe}`, file, {
    access: "private",
    handleUploadUrl: "/api/blob/upload",
    clientPayload: JSON.stringify({ purpose }),
    contentType: file.type || "application/octet-stream",
    multipart: file.size > 4 * 1024 * 1024,
    onUploadProgress: ({ percentage }) => onProgress?.(Math.round(percentage)),
  });
  return { pathname: blob.pathname, contentType: blob.contentType || file.type, sha256, size: file.size, name: file.name };
}
