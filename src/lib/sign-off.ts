import { createHash } from "node:crypto";

/** A drawn signature is a PNG data URL from the signature pad. A blank pad is rejected. */
export function signaturePng(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) throw new Error("Draw your signature in the box.");
  const png = Buffer.from(m[1], "base64");
  if (png.length < 1500 || png.length > 2_000_000) throw new Error("The signature is empty. Please sign in the box.");
  return png;
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
