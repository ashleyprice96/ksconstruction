import "server-only";
import { redirect } from "next/navigation";

/** Read a trimmed string from a form. */
export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === "" ? 0 : Number(v);
};

/** Redirect back with a message. Only fixed or validated text is ever shown. */
export function back(path: string, kind: "error" | "ok", message: string): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(message.slice(0, 600))}`);
}

/** Message to show for an unexpected error: generic, never echoes data. */
export function safeMessage(e: unknown, known: (abstract new (...a: never[]) => Error)[]): string {
  if (known.some((k) => e instanceof k)) return (e as Error).message;
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
  console.error(e);
  return "Something went wrong. Please try again or contact the office.";
}
