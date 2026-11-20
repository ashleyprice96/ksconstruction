/** First release is health and safety. Claims stay in the code and switch on with FEATURE_CLAIMS=true. */

export function claimsEnabled(): boolean {
  return process.env.FEATURE_CLAIMS === "true";
}

export function productName(): string {
  return claimsEnabled() ? "K-S Claims" : "K-S H&S";
}

const CLAIMS_PREFIXES = [
  "/claims", "/payments", "/rates", "/commercial", "/issues", "/notices",
  "/api/commercial", "/api/payruns", "/api/invoices", "/api/backup", "/api/files",
];

/** True when this path is part of the claims product and that product is switched off. */
export function claimsPathBlocked(pathname: string): boolean {
  if (claimsEnabled()) return false;
  return CLAIMS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
