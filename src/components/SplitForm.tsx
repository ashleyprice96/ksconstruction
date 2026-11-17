"use client";
import { useMemo, useState } from "react";

interface Payee { id: string; name: string; legal_name: string; entity_type: string; eligible: boolean }

const fmt = (p: number) => (p / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" });

export default function SplitForm({ totalPence, payees, existing, disabled }:
  { totalPence: number; payees: Payee[]; existing: Record<string, string>; disabled: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(existing);
  const eligible = payees.filter((p) => p.eligible);
  const allocated = useMemo(() => Object.entries(values)
    .filter(([id]) => eligible.some((p) => p.id === id))
    .reduce((a, [, v]) => a + Math.round((Number(v) || 0) * 100), 0), [values, eligible]);
  const remaining = totalPence - allocated;

  function splitEqually() {
    if (!eligible.length) return;
    const base = Math.floor(totalPence / eligible.length);
    let extra = totalPence - base * eligible.length;
    const next: Record<string, string> = {};
    for (const p of eligible) { const v = base + (extra > 0 ? 1 : 0); extra--; next[p.id] = (v / 100).toFixed(2); }
    setValues(next);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Split between your gang</h2>
        <button type="button" className="btn secondary small" onClick={splitEqually} disabled={disabled}>Split equally</button>
      </div>
      {payees.map((p) => (
        <div key={p.id} className="split-row">
          <label htmlFor={`split_${p.id}`} style={{ margin: 0 }}>
            {p.name}
            <span className="hint">{p.legal_name !== p.name ? `${p.legal_name} · ` : ""}{p.entity_type.replace("_", " ")}{!p.eligible && " · not cleared for payment"}</span>
          </label>
          <input id={`split_${p.id}`} name={`split_${p.id}`} type="number" inputMode="decimal" min="0" step="0.01"
            value={values[p.id] ?? ""} disabled={!p.eligible || disabled}
            onChange={(e) => setValues({ ...values, [p.id]: e.target.value })} aria-describedby="remaining" />
        </div>
      ))}
      <div className="total-line" id="remaining" aria-live="polite">
        <span>{remaining >= 0 ? "Left to allocate" : "Over by"}</span>
        <span style={{ color: remaining < 0 ? "var(--bad)" : remaining === 0 ? "var(--ok)" : undefined }}>{fmt(Math.abs(remaining))}</span>
      </div>
      {payees.some((p) => !p.eligible) && <p className="small muted">Members who are not cleared for payment cannot receive a split. Contact the office.</p>}
    </div>
  );
}
