import { currentUser } from "@/lib/auth";
import { safetyCsv } from "@/lib/safety";

export async function GET() {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) return new Response("Not found", { status: 404 });
  const csv = await safetyCsv();
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"hs-confirmations.csv\"",
      "Cache-Control": "private, no-store",
    },
  });
}
