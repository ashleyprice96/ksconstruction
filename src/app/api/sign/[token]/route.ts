import { shareByToken, shareFileBytes } from "@/lib/share";
import { isRemoteKey, remoteStore } from "@/lib/remote-file";
import { pdfStreamResponse } from "@/lib/pdf-stream";

/** The shared file. The token is the access check. Switched-off links return nothing. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const item = await shareByToken(token);
  if (!item?.active || !item.file_name || !item.file_mime) return new Response("Not found", { status: 404 });
  const name = item.file_name;
  if (item.file_mime === "application/pdf") {
    let length = item.file_bytes?.length ?? 0;
    if (item.storage_key && isRemoteKey(item.storage_key)) length = (await remoteStore(item.storage_key).head(item.storage_key)) ?? 0;
    if (!length) return new Response("Not found", { status: 404 });
    const key = item.storage_key;
    const stored = item.file_bytes;
    return pdfStreamResponse(req, { length, name }, async (start, end) => {
      if (key && isRemoteKey(key)) return (await remoteStore(key).get(key, { start, end })) ?? Buffer.alloc(0);
      return stored ? stored.subarray(start, end + 1) : Buffer.alloc(0);
    });
  }
  const body = await shareFileBytes(item);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": item.file_mime,
      "Content-Disposition": `inline; filename="${name.replace(/[^\w.\- ]/g, "_")}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
