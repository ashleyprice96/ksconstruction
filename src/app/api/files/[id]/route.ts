import { currentUser } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { readStoredFile } from "@/lib/files";

// Serves an uploaded file only to someone allowed to see its claim or issue.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const a = await q1<{ storage_key: string; mime: string; original_name: string; claim_gang: string | null; issue_gang: string | null; issue_id: string | null }>(
    `SELECT a.storage_key, a.mime, a.original_name, c.gang_id AS claim_gang, i.gang_id AS issue_gang, a.issue_id
     FROM ops.attachments a LEFT JOIN ops.claims c ON c.id = a.claim_id LEFT JOIN ops.issues i ON i.id = a.issue_id
     WHERE a.id = $1`, [id]);
  if (!a) return new Response("Not found", { status: 404 });
  if (user.role === "gang") {
    const gang = a.issue_id ? a.issue_gang : a.claim_gang;
    if (gang !== user.gang_id) return new Response("Not found", { status: 404 });
  }
  const body = await readStoredFile(a.storage_key).catch(() => null);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": a.mime,
      "Content-Disposition": `inline; filename="${a.original_name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
