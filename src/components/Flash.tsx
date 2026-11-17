export default function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const error = typeof sp.error === "string" ? sp.error : null;
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  return (
    <>
      {error && <div className="alert error" role="alert">{error}</div>}
      {ok && <div className="alert ok" role="status">{ok}</div>}
      {sp.denied && <div className="alert error" role="alert">You do not have access to that page.</div>}
    </>
  );
}
