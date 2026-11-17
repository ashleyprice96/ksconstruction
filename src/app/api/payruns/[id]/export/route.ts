import { currentUser } from "@/lib/auth";
import { safetyApiBlock } from "@/lib/safety";
import { q1 } from "@/lib/db";
import { audit } from "@/lib/audit";
import { splitsCsv, wagesWorkbook } from "@/lib/payments";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || (user.role !== "management" && user.role !== "admin")) return new Response("Not found", { status: 404 });
  const blocked = await safetyApiBlock(user);
  if (blocked) return blocked;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const run = await q1<{ d: string }>("SELECT to_char(payment_date, 'YYYY-MM-DD') AS d FROM ops.pay_runs WHERE id = $1", [id]);
  if (!run) return new Response("Not found", { status: 404 });
  const format = new URL(req.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  await audit(user.id, "pay_run", id, `exported_${format}`);
  if (format === "csv") {
    return new Response(await splitsCsv(id), { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="KS-pay-run-${run.d}-splits.csv"` } });
  }
  return new Response(new Uint8Array(await wagesWorkbook(id)), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="KS-pay-run-${run.d}.xlsx"` } });
}
