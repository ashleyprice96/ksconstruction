import { currentUser } from "@/lib/auth";
import { ramsCsv } from "@/lib/rams";

export async function GET() {
  const user = await currentUser();
  if (!user || (user.role !== "admin" && user.role !== "management")) return new Response("Not found", { status: 404 });
  return new Response(await ramsCsv(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"rams-confirmations.csv\"" },
  });
}
