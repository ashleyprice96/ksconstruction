import { currentUser } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { readStoredFile } from "@/lib/files";
import { isRemoteKey, remoteStore } from "@/lib/remote-file";
import { pdfStreamResponse, readByteaSlice } from "@/lib/pdf-stream";

/** PDF or image on a health and safety item. PDFs are streamed. Auth is checked first. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const meta = await q1<{ n: number | null; attachment_name: string | null; attachment_mime: string | null; active: boolean; attachment_key: string | null; in_db: boolean }>(
    `SELECT octet_length(attachment_bytes)::int AS n, attachment_name, attachment_mime, active, attachment_key,
            (attachment_bytes IS NOT NULL) AS in_db
     FROM ops.hs_alerts WHERE id = $1`, [id]);
  if (!meta || !meta.attachment_name) return new Response("Not found", { status: 404 });
  if (user.role === "gang" && !meta.active) return new Response("Not found", { status: 404 });
  const name = meta.attachment_name;
  if (meta.attachment_mime === "application/pdf" && (meta.in_db || isRemoteKey(meta.attachment_key))) {
    let length = meta.n ?? 0;
    if (isRemoteKey(meta.attachment_key)) length = (await remoteStore(meta.attachment_key).head(meta.attachment_key)) ?? 0;
    if (!length) return new Response("Not found", { status: 404 });
    const key = meta.attachment_key;
    return pdfStreamResponse(req, { length, name }, async (start, end) => {
      if (isRemoteKey(key)) return (await remoteStore(key).get(key, { start, end })) ?? Buffer.alloc(0);
      return readByteaSlice("ops.hs_alerts", "attachment_bytes", id, start, end);
    });
  }
  const body = meta.attachment_key ? await readStoredFile(meta.attachment_key).catch(() => null) : null;
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": meta.attachment_mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${name.replace(/[^\w.\- ]/g, "_")}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
