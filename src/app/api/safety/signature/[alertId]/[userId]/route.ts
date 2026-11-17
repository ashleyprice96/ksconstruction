import { currentUser } from "@/lib/auth";
import { q1 } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ alertId: string; userId: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) return new Response("Not found", { status: 404 });
  const { alertId, userId } = await params;
  const row = await q1<{ signature_png: Buffer }>(
    "SELECT signature_png FROM ops.hs_acknowledgements WHERE alert_id = $1 AND user_id = $2 AND signature_png IS NOT NULL",
    [alertId, userId]);
  if (!row) return new Response("Not found", { status: 404 });
  const png = Buffer.isBuffer(row.signature_png) ? row.signature_png : Buffer.from(row.signature_png);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
}
