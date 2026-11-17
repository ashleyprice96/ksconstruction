import { q } from "@/lib/db";

/** Measures, walls and evidence of a claim. Never shows rates or money. */
export default async function ClaimSummary({ claimId }: { claimId: string }) {
  const [lines, walls, files] = await Promise.all([
    q<{ description: string; unit: string; quantity: string }>("SELECT description, unit, quantity FROM ops.claim_lines WHERE claim_id = $1 ORDER BY description", [claimId]),
    q<{ wall_ref: string; courses: number }>("SELECT wall_ref, courses FROM ops.wall_measures WHERE claim_id = $1 ORDER BY wall_ref", [claimId]),
    q<{ id: string; kind: string; original_name: string; mime: string }>(
      "SELECT id, kind, original_name, mime FROM ops.attachments WHERE claim_id = $1 AND kind <> 'signature' ORDER BY kind, uploaded_at", [claimId]),
  ]);
  return (
    <>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <thead><tr><th>Work</th><th className="num">Quantity</th><th>Unit</th></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={3} className="muted">No work entered.</td></tr>}
            {lines.map((l, i) => <tr key={i}><td>{l.description}</td><td className="num">{Number(l.quantity)}</td><td>{l.unit}</td></tr>)}
          </tbody>
        </table>
      </div>
      {walls.length > 0 && (
        <p><strong>Courses per wall:</strong> {walls.map((w) => `${w.wall_ref}: ${w.courses}`).join(" · ")}</p>
      )}
      {files.length > 0 && (
        <div className="thumbs">
          {files.map((f) => (
            <figure key={f.id}>
              <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
                {f.mime.startsWith("image/") && f.mime !== "image/heic"
                  ? <img src={`/api/files/${f.id}`} alt={f.original_name} />
                  : <div className="file-tile">Open file</div>}
              </a>
              <figcaption>{f.kind.replace("_", " ")}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  );
}
