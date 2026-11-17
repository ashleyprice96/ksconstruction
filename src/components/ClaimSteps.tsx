import Link from "next/link";

const STEPS = [
  { key: "quantities", label: "1. Work" },
  { key: "evidence", label: "2. Photos" },
  { key: "sign", label: "3. Foreman" },
  { key: "split", label: "4. Split and submit" },
];

export default function ClaimSteps({ id, current, signatureRequired = true }: { id: string; current: string; signatureRequired?: boolean }) {
  const visible = STEPS.filter((s) => signatureRequired || s.key !== "sign");
  const here = visible.findIndex((s) => s.key === current);
  return (
    <div className="steps" aria-label="Claim steps">
      {visible.map((s, i) =>
        s.key === current
          ? <span key={s.key} className="current" aria-current="step">{s.label}</span>
          : <Link key={s.key} href={`/claims/${id}/${s.key}`} className={i < here ? "done" : undefined}>{s.label}</Link>)}
    </div>
  );
}
