import "server-only";
import { q1 } from "./db";

const CHUNK = 256 * 1024;

export interface PdfMeta { length: number; name: string }

/** Read one slice of a bytea column. Offsets are zero-based and inclusive. */
export async function readByteaSlice(table: "ops.site_rams" | "ops.hs_alerts", column: "pdf_bytes" | "attachment_bytes", id: string, start: number, end: number): Promise<Buffer> {
  const length = end - start + 1;
  const row = await q1<{ chunk: Buffer }>(
    `SELECT substring(${column} FROM $2::int FOR $3::int) AS chunk FROM ${table} WHERE id = $1`,
    [id, start + 1, length]);
  const chunk = row?.chunk;
  if (!chunk) return Buffer.alloc(0);
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
}

function parseRange(header: string | null, size: number): { start: number; end: number } | "bad" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "bad";
  let start = match[1] ? Number(match[1]) : NaN;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    const tail = Number(match[2]);
    start = Math.max(0, size - tail);
    end = size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return "bad";
  return { start, end: Math.min(end, size - 1) };
}

/** Serve a stored PDF. A range request reads only that slice from Postgres. */
export async function pdfStreamResponse(req: Request, meta: PdfMeta, read: (start: number, end: number) => Promise<Buffer>): Promise<Response> {
  const range = parseRange(req.headers.get("range"), meta.length);
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private",
    "Content-Disposition": `inline; filename="${meta.name.replace(/[^\w.\- ]/g, "_")}"`,
    "X-Content-Type-Options": "nosniff",
  });
  if (range === "bad") {
    headers.set("Content-Range", `bytes */${meta.length}`);
    return new Response("Bad range", { status: 416, headers });
  }
  if (range) {
    const body = await read(range.start, range.end);
    headers.set("Content-Length", String(body.length));
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${meta.length}`);
    return new Response(new Uint8Array(body), { status: 206, headers });
  }
  headers.set("Content-Length", String(meta.length));
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= meta.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + CHUNK, meta.length) - 1;
      const body = await read(offset, end);
      if (!body.length) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(body));
      offset += body.length;
    },
  });
  return new Response(stream, { status: 200, headers });
}

export async function byteaLength(table: "ops.site_rams" | "ops.hs_alerts", column: "pdf_bytes" | "attachment_bytes", id: string): Promise<number | null> {
  const row = await q1<{ n: number }>(`SELECT octet_length(${column})::int AS n FROM ${table} WHERE id = $1`, [id]);
  return row?.n ?? null;
}
