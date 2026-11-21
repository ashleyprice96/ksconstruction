import { hsPdfMaxBytes } from "./hs-pdf";

/** What the browser is uploading. Health and safety files are not the same as a top sheet. */
export type BlobPurpose = "hs" | "rams" | "topsheet";

const PREFIX: Record<BlobPurpose, string> = {
  hs: "blob/hs/",
  rams: "blob/rams/",
  topsheet: "blob/topsheet/",
};

export function purposeOf(clientPayload: string | null): string {
  try {
    const parsed = JSON.parse(clientPayload ?? "") as { purpose?: unknown };
    return typeof parsed.purpose === "string" ? parsed.purpose : "";
  } catch {
    return "";
  }
}

export function isBlobPurpose(value: string): value is BlobPurpose {
  return value === "hs" || value === "rams" || value === "topsheet";
}

/** Pathnames the server will later download. A full URL is never accepted. */
export function blobPathAllowed(pathname: string, purpose: BlobPurpose): boolean {
  return pathname.startsWith(PREFIX[purpose])
    && pathname.length <= 240
    && !pathname.includes("..")
    && !pathname.includes("://")
    && /^blob\/(hs|rams|topsheet)\/[A-Za-z0-9._-]+$/.test(pathname);
}

export type BlobDecision =
  | { ok: true; purpose: BlobPurpose }
  | { ok: false; status: number; error: string };

/**
 * Who may ask for an upload token.
 * Health and safety files: an administrator or a manager.
 * Top sheets: a gang lead or the office. A contracts manager does not add them.
 */
export function decideBlobToken(role: string | null | undefined, purposeRaw: string, pathname: string): BlobDecision {
  if (!role) return { ok: false, status: 401, error: "Sign in first." };
  if (!isBlobPurpose(purposeRaw)) return { ok: false, status: 400, error: "Unknown upload." };
  const hs = purposeRaw === "hs" || purposeRaw === "rams";
  if (hs && role !== "admin" && role !== "management") {
    return { ok: false, status: 403, error: "Only an administrator or a manager can upload a health and safety file." };
  }
  if (purposeRaw === "topsheet" && role !== "admin" && role !== "management" && role !== "gang") {
    return { ok: false, status: 403, error: "You cannot upload a top sheet." };
  }
  if (!blobPathAllowed(pathname, purposeRaw)) return { ok: false, status: 400, error: "That file path is not allowed." };
  return { ok: true, purpose: purposeRaw };
}

export function blobTokenConfig(purpose: BlobPurpose) {
  if (purpose === "rams") {
    return { maximumSizeInBytes: hsPdfMaxBytes(), allowedContentTypes: ["application/pdf"], addRandomSuffix: true as const };
  }
  if (purpose === "topsheet") {
    return {
      maximumSizeInBytes: 6 * 1024 * 1024,
      allowedContentTypes: ["image/jpeg", "image/png", "application/pdf"],
      addRandomSuffix: true as const,
    };
  }
  return {
    maximumSizeInBytes: hsPdfMaxBytes(),
    allowedContentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    addRandomSuffix: true as const,
  };
}
