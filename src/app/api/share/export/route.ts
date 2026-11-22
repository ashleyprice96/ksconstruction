import { currentUser } from "@/lib/auth";
import { shareBoard, shareCsv } from "@/lib/share";

export async function GET() {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) return new Response("Not found", { status: 404 });
  const csv = shareCsv(await shareBoard());
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"share-to-sign.csv\"" },
  });
}
