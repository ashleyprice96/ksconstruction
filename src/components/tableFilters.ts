/** Show or hide already-rendered table rows. Does not refetch or change stored data. */
export function applyFilters(table: HTMLTableElement) {
  const q = (document.body.dataset.ksSearch ?? "").trim().toLowerCase();
  const date = table.dataset.filterDate || "all";
  const gang = table.dataset.filterGang || "all";
  const site = table.dataset.filterSite || "all";
  const status = table.dataset.filterStatus || "all";
  const today = table.dataset.today ?? "";
  const weekStart = table.dataset.weekStart ?? "";
  const weekEnd = table.dataset.weekEnd ?? "";
  const month = today.slice(0, 7);
  const body = table.tBodies[0];
  if (!body) return;
  let visible = 0;
  let data = 0;
  for (const tr of Array.from(body.rows)) {
    if (tr.dataset.empty === "1" || tr.dataset.filterEmpty === "1") continue;
    data += 1;
    const iso = tr.dataset.date ?? "";
    let dateOk = true;
    if (date === "week") dateOk = iso !== "" && iso >= weekStart && iso <= weekEnd;
    else if (date === "month") dateOk = iso !== "" && iso.slice(0, 7) === month;
    else if (date === "older") dateOk = iso !== "" && weekStart !== "" && iso < weekStart;
    const ok = dateOk
      && (gang === "all" || tr.dataset.gang === gang)
      && (site === "all" || tr.dataset.site === site)
      && (status === "all" || tr.dataset.status === status)
      && (q === "" || (tr.textContent ?? "").toLowerCase().includes(q));
    tr.hidden = !ok;
    if (ok) visible += 1;
  }
  const filterEmpty = body.querySelector<HTMLTableRowElement>("tr[data-filter-empty='1']");
  if (filterEmpty) filterEmpty.hidden = visible !== 0 || data === 0;
  const serverEmpty = body.querySelector<HTMLTableRowElement>("tr[data-empty='1']");
  if (serverEmpty) serverEmpty.hidden = data !== 0;
}
