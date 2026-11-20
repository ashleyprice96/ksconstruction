import Link from "next/link";
import { requireUser, isManager } from "@/lib/auth";
import { q } from "@/lib/db";
import { pendingSafetyAlerts } from "@/lib/safety";
import { claimsEnabled } from "@/lib/features";
import Flash from "@/components/Flash";

export default async function HsHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const gang = user.role === "gang";
  if (gang) return <GangHome user={user} sp={sp} />;
  return <OfficeHome canSetup={isManager(user)} sp={sp} />;
}

async function GangHome({ user, sp }: { user: import("@/lib/auth").User; sp: Record<string, string> }) {
  const pending = await pendingSafetyAlerts(user);
  const alerts = pending.filter((a) => a.kind === "alert");
  const talks = pending.filter((a) => a.kind === "toolbox");
  const latest = await q<{ kind: string; title: string; signed: boolean }>(
    `SELECT DISTINCT ON (a.kind) a.kind, a.title,
            EXISTS (SELECT 1 FROM ops.hs_acknowledgements k WHERE k.alert_id = a.id AND k.user_id = $1) AS signed
     FROM ops.hs_alerts a WHERE a.active ORDER BY a.kind, a.published_at DESC`, [user.id]);
  const latestAlert = latest.find((row) => row.kind === "alert");
  const latestTalk = latest.find((row) => row.kind === "toolbox");
  const sites = await q<{ id: string; name: string; has_rams: boolean; needs_sign: boolean }>(
    `SELECT s.id, s.name,
            EXISTS (SELECT 1 FROM ops.site_rams r WHERE r.site_id = s.id AND r.active) AS has_rams,
            EXISTS (
              SELECT 1 FROM ops.site_rams r
              WHERE r.site_id = s.id AND r.active AND NOT EXISTS (
                SELECT 1 FROM ops.rams_acknowledgements k WHERE k.rams_id = r.id AND k.user_id = $1)
            ) AS needs_sign
     FROM ops.sites s WHERE s.active ORDER BY s.name`, [user.id]);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">K-S H&amp;S</div>
          <h1>Hello, {user.name.split(" ")[0]}</h1>
          <p className="small muted">Sign the latest alert and toolbox talk, then open the RAMS for each site.</p>
        </div>
      </div>
      <Flash sp={sp} />
      <div className="kpi-strip">
        <div className="stat"><div className="l">Alerts to sign</div><div className="n">{alerts.length}</div></div>
        <div className="stat"><div className="l">Toolbox talks to sign</div><div className="n">{talks.length}</div></div>
        <div className="stat"><div className="l">Sites needing RAMS</div><div className="n">{sites.filter((s) => s.needs_sign).length}</div></div>
      </div>
      <Waiting title="Latest alert" items={alerts} empty={latestAlert ? `${latestAlert.title} — ${latestAlert.signed ? "signed" : "still to sign"}` : "No alert is waiting for your signature."} />
      <Waiting title="Toolbox talks" items={talks} empty={latestTalk ? `${latestTalk.title} — ${latestTalk.signed ? "signed" : "still to sign"}` : "No toolbox talk is waiting for your signature."} />
      <section className="panel">
        <h2>My sites RAMS</h2>
        <p className="small muted">Open a site, read the current RAMS, sign it, and tick who was briefed. A new version needs signing again.</p>
        <ul className="stack">
          {sites.map((site) => (
            <li key={site.id}>
              <strong>{site.name}</strong>
              {" · "}
              {!site.has_rams && <span className="muted">No RAMS published</span>}
              {site.has_rams && site.needs_sign && <Link href={`/safety/rams/${site.id}?next=/`}>Needs signing</Link>}
              {site.has_rams && !site.needs_sign && <span>Signed</span>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Waiting({ title, items, empty }: { title: string; items: { id: string; title: string }[]; empty: string }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {items.length === 0 ? <p className="muted">{empty}</p> : (
        <ul>{items.map((item) => <li key={item.id}><Link href="/safety">{item.title}</Link></li>)}</ul>
      )}
    </section>
  );
}

async function OfficeHome({ canSetup, sp }: { canSetup: boolean; sp: Record<string, string> }) {
  const claimsOff = !claimsEnabled();
  const rows = await q<{ id: string; kind: string; title: string; site: string | null; outstanding: string; missing: string | null }>(
    `SELECT a.id, a.kind, a.title, NULL::text AS site,
            count(*) FILTER (WHERE k.user_id IS NULL)::text AS outstanding,
            string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE k.user_id IS NULL) AS missing
     FROM ops.hs_alerts a
     JOIN ops.users u ON u.active AND (
       NOT EXISTS (SELECT 1 FROM ops.hs_alert_sites s WHERE s.alert_id = a.id)
       OR u.gang_id IS NULL
       OR $1::boolean
       OR EXISTS (
         SELECT 1 FROM ops.hs_alert_sites s
         JOIN ops.claims c ON c.site_id = s.site_id AND c.gang_id = u.gang_id AND c.deleted_at IS NULL
         WHERE s.alert_id = a.id))
     LEFT JOIN ops.hs_acknowledgements k ON k.alert_id = a.id AND k.user_id = u.id
     WHERE a.active
     GROUP BY a.id
     UNION ALL
     SELECT r.id, 'rams', r.title, si.name, count(*) FILTER (WHERE k.user_id IS NULL)::text,
            string_agg(u.name, ', ' ORDER BY u.name) FILTER (WHERE k.user_id IS NULL)
     FROM ops.site_rams r
     JOIN ops.sites si ON si.id = r.site_id
     JOIN ops.users u ON u.active AND u.role = 'gang'
     LEFT JOIN ops.rams_acknowledgements k ON k.rams_id = r.id AND k.user_id = u.id
     WHERE r.active
     GROUP BY r.id, si.name
     ORDER BY 2, 3`, [claimsOff]);
  const alerts = rows.filter((r) => r.kind === "alert");
  const talks = rows.filter((r) => r.kind === "toolbox");
  const rams = rows.filter((r) => r.kind === "rams");
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">K-S H&amp;S</div>
          <h1>Health and safety</h1>
          <p className="small muted">Outstanding signatures. Everyone with a login signs alerts and toolbox talks. Gang leads sign each site RAMS.</p>
        </div>
        {canSetup && <div className="actions"><Link className="btn" href="/setup?s=safety">Open Setup</Link></div>}
      </div>
      <Flash sp={sp} />
      <Status title="Alerts" rows={alerts} />
      <Status title="Toolbox talks" rows={talks} />
      <Status title="Site RAMS" rows={rams} />
    </>
  );
}

function Status({ title, rows }: { title: string; rows: { id: string; title: string; site: string | null; outstanding: string; missing: string | null }[] }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="muted">Nothing published.</p> : (
        <ul className="stack">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{row.site ? `${row.site}: ${row.title}` : row.title}</strong>
              {" · "}
              {Number(row.outstanding) === 0 ? "Everyone has signed" : `${row.outstanding} still to sign: ${row.missing}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
