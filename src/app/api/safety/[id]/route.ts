import { currentUser } from "@/lib/auth";
import { readStoredFile } from "@/lib/files";
import { safetyFile } from "@/lib/safety";

/** Attachment on a health and safety alert. Available on the confirmation gate. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const file = await safetyFile(user, id);
  if (!file) return new Response("Not found", { status: 404 });
  const body = await readStoredFile(file.attachment_key).catch(() => null);
  if (!body) return new Response("Not found", { status: 404 });
  const name = file.attachment_name.replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": file.attachment_mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
