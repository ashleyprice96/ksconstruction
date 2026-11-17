import ExcelJS from "exceljs";
import { currentUser } from "@/lib/auth";
import { isNamedUser, marginBy, marginDetail } from "@/lib/commercial";

// Margin export for the named list only. Logged by withCommercial.
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || !(await isNamedUser(user))) return new Response("Not found", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const ok = (d: string | null) => d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const from = sp.get("from"); const to = sp.get("to");
  if (!ok(from) || !ok(to)) return new Response("Bad request", { status: 400 });
  const detail = await marginDetail(user, from!, to!);
  const wb = new ExcelJS.Workbook();
  const style = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF211F20" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };
  const money = ["gang_cost", "client_rate", "client_value", "margin"];
  const ws = wb.addWorksheet("Margin detail");
  const keys = ["week_ending", "client", "site", "gang", "claim", "claim_type", "description", "quantity", "gang_cost", "client_rate", "client_value", "margin"];
  ws.columns = keys.map((k) => ({ header: k.replace("_", " "), key: k, width: money.includes(k) ? 13 : 18 }));
  for (const r of detail) ws.addRow(Object.fromEntries(keys.map((k) => [k, money.includes(k) || k === "quantity" ? (r[k] === null ? null : Number(r[k])) : r[k]])));
  keys.forEach((k, i) => { if (money.includes(k)) ws.getColumn(i + 1).numFmt = '"£"#,##0.00'; });
  style(ws);
  for (const g of ["gang", "site", "client", "week"] as const) {
    const rows = await marginBy(user, g, from!, to!);
    const s = wb.addWorksheet(`By ${g}`);
    s.columns = [{ header: g, key: "label", width: 26 }, { header: "gang cost", key: "gang_cost", width: 14 }, { header: "client value", key: "client_value", width: 14 },
      { header: "margin", key: "margin", width: 14 }, { header: "margin %", key: "margin_pct", width: 10 }, { header: "unpriced lines", key: "unpriced_lines", width: 14 }];
    for (const r of rows) s.addRow({ ...r, gang_cost: Number(r.gang_cost), client_value: Number(r.client_value), margin: Number(r.margin), margin_pct: r.margin_pct === null ? null : Number(r.margin_pct), unpriced_lines: Number(r.unpriced_lines) });
    [2, 3, 4].forEach((c) => (s.getColumn(c).numFmt = '"£"#,##0.00'));
    style(s);
  }
  const about = wb.addWorksheet("About");
  about.addRows([["RESTRICTED: K-S named list only. Contains client rates, client values and margin."], ["Week endings", `${from} to ${to}`], ["Exported by", user.name], ["Exported at", new Date().toISOString()]]);
  return new Response(new Uint8Array(await wb.xlsx.writeBuffer()), { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="KS-margin-${from}-to-${to}-RESTRICTED.xlsx"`, "Cache-Control": "no-store" } });
}
