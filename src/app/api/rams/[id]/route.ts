import { currentUser } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { readStoredFile } from "@/lib/files";
import { activeObjectStore } from "@/lib/storage-s3";
import { pdfStreamResponse, readByteaSlice } from "@/lib/pdf-stream";

/** Streams a RAMS PDF. Auth is checked here; the bucket stays private. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const meta = await q1<{ n: number | null; pdf_name: string; active: boolean; storage_key: string | null }>(
    "SELECT octet_length(pdf_bytes)::int AS n, pdf_name, active, storage_key FROM ops.site_rams WHERE id = $1", [id]);
  if (!meta) return new Response("Not found", { status: 404 });
  if (user.role === "gang" && !meta.active) return new Response("Not found", { status: 404 });
  let length = meta.n ?? 0;
  if (meta.storage_key) {
    const store = await activeObjectStore();
    length = (await store?.head(meta.storage_key)) ?? 0;
  }
  if (!length) return new Response("Not found", { status: 404 });
  const key = meta.storage_key;
  return pdfStreamResponse(req, { length, name: meta.pdf_name }, async (start, end) => {
    if (key) {
      const store = await activeObjectStore();
      return (await store?.get(key, { start, end })) ?? Buffer.alloc(0);
    }
    return readByteaSlice("ops.site_rams", "pdf_bytes", id, start, end);
  });
}
