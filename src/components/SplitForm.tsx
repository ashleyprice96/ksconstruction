"use client";
import { useMemo, useState } from "react";

export interface SplitMember { id: string; name: string }

const money = (p: number) => (p / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" });

export default function SplitForm({
  totalPence, members, existing, disabled,
}: {
  totalPence: number;
  members: SplitMember[];
  existing: Record<string, string>;
  disabled: boolean;
}) {
  const [basis, setBasis] = useState<"amount" | "percent">(existing.basis === "percent" ? "percent" : "amount");
  const [values, setValues] = useState<Record<string, string>>(existing);
  const numbers = useMemo(() => members.map((m) => Number(values[m.id]) || 0), [members, values]);
  const percentSum = numbers.reduce((a, b) => a + b, 0);
  const amountPence = numbers.reduce((a, b) => a + Math.round(b * 100), 0);
  const remaining = basis === "percent" ? Math.round((100 - percentSum) * 100) / 100 : totalPence - amountPence;
  const exact = basis === "percent" ? Math.abs(remaining) < 0.001 : remaining === 0;

  function splitEqually() {
    if (!members.length) return;
    const next: Record<string, string> = {};
    if (basis === "percent") {
      const base = Math.floor(10000 / members.length);
      let extra = 10000 - base * members.length;
      for (const m of members) {
        const share = base + (extra > 0 ? 1 : 0);
        extra -= extra > 0 ? 1 : 0;
        next[m.id] = (share / 100).toFixed(2);
      }
    } else {
      const base = Math.floor(totalPence / members.length);
      let extra = totalPence - base * members.length;
      for (const m of members) {
        const share = base + (extra > 0 ? 1 : 0);
        extra -= extra > 0 ? 1 : 0;
        next[m.id] = (share / 100).toFixed(2);
      }
    }
    setValues(next);
  }

  return (
    <div data-testid="member-split">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Split between your gang</h2>
        <button type="button" className="btn secondary small" onClick={splitEqually} disabled={disabled || !members.length}>Split equally</button>
      </div>
      <p className="small muted">These people do not get a login. The split must equal the claim exactly. You can change it until K-S confirms the claim.</p>
      <input type="hidden" name="basis" value={basis} />
      <div className="row">
        <label className="check"><input type="radio" name="basis_choice" checked={basis === "amount"} onChange={() => { setBasis("amount"); setValues({}); }} /> Amounts in pounds</label>
        <label className="check"><input type="radio" name="basis_choice" checked={basis === "percent"} onChange={() => { setBasis("percent"); setValues({}); }} /> Percentages</label>
      </div>
      {members.length === 0 && <p className="muted">Add the people in your gang first.</p>}
      {members.map((m) => (
        <div key={m.id} className="split-row">
          <label htmlFor={`split_${m.id}`} style={{ margin: 0 }}>{m.name}</label>
          <input id={`split_${m.id}`} name={`split_${m.id}`} type="number" inputMode="decimal" min="0" step="0.01"
            max={basis === "percent" ? 100 : undefined}
            value={values[m.id] ?? ""} disabled={disabled}
            onChange={(e) => setValues({ ...values, [m.id]: e.target.value })} aria-describedby="remaining" />
        </div>
      ))}
      <div className="total-line" id="remaining" aria-live="polite">
        <span>{remaining > 0 ? "Still to allocate" : remaining < 0 ? "Over by" : "Allocated"}</span>
        <span style={{ color: exact ? "var(--ok)" : "var(--bad)" }}>
          {basis === "percent" ? `${Math.abs(remaining).toFixed(2)}%` : money(Math.abs(remaining))}
        </span>
      </div>
      {basis === "percent" && totalPence > 0 && <p className="small muted">100% is {money(totalPence)}.</p>}
    </div>
  );
}
