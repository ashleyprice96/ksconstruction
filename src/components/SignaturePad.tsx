"use client";
import { useEffect, useRef, useState } from "react";

/** Finger or mouse signature. Writes a PNG data URL into a hidden input. */
export default function SignaturePad({ name }: { name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    let drawing = false;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const down = (e: PointerEvent) => { drawing = true; c.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const move = (e: PointerEvent) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
    const up = () => {
      if (!drawing) return;
      drawing = false;
      setEmpty(false);
      if (hidden.current) hidden.current.value = c.toDataURL("image/png");
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", up);
    return () => {
      c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up); c.removeEventListener("pointerleave", up);
    };
  }, []);

  function clear() {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.restore();
    setEmpty(true);
    if (hidden.current) hidden.current.value = "";
  }

  return (
    <div>
      <canvas ref={canvas} className="sigpad" aria-label="Signature box. Sign with your finger." />
      <input ref={hidden} type="hidden" name={name} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span className="small muted">{empty ? "Sign in the box above." : "Signed."}</span>
        <button type="button" className="btn secondary small" onClick={clear}>Clear</button>
      </div>
    </div>
  );
}
