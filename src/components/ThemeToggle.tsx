"use client";

/** Light and dark follow the system until someone chooses, then the choice is remembered on this device. */
export default function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const current = root.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("ks-theme", next); } catch { /* private mode */ }
  }

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="Switch colour theme">
      <span className="when-light">Dark</span>
      <span className="when-dark">Light</span>
    </button>
  );
}
