/** Smooth area chart. Inline SVG only, no chart library. */
export default function AreaChart({ points, caption }: { points: { label: string; value: number }[]; caption: string }) {
  const w = 640;
  const h = 150;
  const padX = 6;
  const padTop = 12;
  const padBottom = 8;
  const max = Math.max(...points.map((p) => p.value), 1);
  const innerW = w - padX * 2;
  const innerH = h - padTop - padBottom;
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? w / 2 : padX + (innerW * i) / (points.length - 1);
    const y = padTop + innerH - (p.value / max) * innerH;
    return [x, y] as const;
  });

  function curve(pts: readonly (readonly [number, number])[]) {
    if (pts.length === 0) return "";
    let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] ?? p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  const line = curve(coords);
  const baseY = (padTop + innerH).toFixed(1);
  const area = coords.length
    ? `${line} L ${coords[coords.length - 1][0].toFixed(1)} ${baseY} L ${coords[0][0].toFixed(1)} ${baseY} Z`
    : "";

  return (
    <figure className="area-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={caption}>
        <defs>
          <linearGradient id="ks-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#ks-area)" />}
        {line && <path d={line} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {coords.map(([x, y], i) => <circle key={points[i].label} cx={x} cy={y} r="3.2" fill="#fff" />)}
      </svg>
      <ol className="area-labels">
        {points.map((p, i) => {
          const show = points.length <= 8 || i % 2 === 0 || i === points.length - 1;
          return <li key={p.label}>{show ? p.label : ""}</li>;
        })}
      </ol>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead><tr><th>Week</th><th>Total</th></tr></thead>
        <tbody>
          {points.map((p) => <tr key={p.label}><td>{p.label}</td><td>{p.value}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}
