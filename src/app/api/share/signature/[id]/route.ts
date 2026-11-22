import { currentUser } from "@/lib/auth";
import { q1 } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await q1<{ signature_png: Buffer }>(
    "SELECT signature_png FROM ops.share_signatures WHERE id = $1", [id]);
  if (!row?.signature_png) return new Response("Not found", { status: 404 });
  const png = Buffer.isBuffer(row.signature_png) ? row.signature_png : Buffer.from(row.signature_png);
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "private", "X-Content-Type-Options": "nosniff" },
  });
}
