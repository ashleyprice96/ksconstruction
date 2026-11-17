// Manage the named list for client rates, client values and margin.
// Runs with the OWNER login only, so it cannot be done from inside the app.
//   npm run commercial:access -- list
//   npm run commercial:access -- add someone@company.co.uk "Reason" "Changed by"
//   npm run commercial:access -- remove someone@company.co.uk "Reason" "Changed by"
//   npm run commercial:access -- log [days]
import { openOwner, reportFailure } from "./script-db";

async function main() {
  const [cmd, email, reason = "", by = process.env.USER ?? "owner"] = process.argv.slice(2);
  const db = await openOwner();
  await db.query("SET row_security = off");
  try {
    if (cmd === "list") {
      const r = await db.query(`SELECT u.name, u.email, u.role, a.added_at, a.added_by FROM commercial.access_list a JOIN ops.users u ON u.id = a.user_id ORDER BY u.name`);
      console.table(r.rows);
    } else if (cmd === "add" || cmd === "remove") {
      if (!email) throw new Error("Give the user's email.");
      const u = (await db.query("SELECT id, name FROM ops.users WHERE lower(email) = lower($1) OR lower(username) = lower($1)", [email])).rows[0];
      if (!u) throw new Error("No user with that email or username. Create the user in the app first.");
      await db.query("BEGIN");
      if (cmd === "add") await db.query("INSERT INTO commercial.access_list (user_id, added_by, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [u.id, by, reason]);
      else await db.query("DELETE FROM commercial.access_list WHERE user_id = $1", [u.id]);
      await db.query("INSERT INTO commercial.access_list_history (user_id, action, changed_by, reason) VALUES ($1, $2, $3, $4)", [u.id, cmd === "add" ? "added" : "removed", by, reason]);
      await db.query("COMMIT");
      console.log(`${u.name} ${cmd === "add" ? "added to" : "removed from"} the named list.`);
    } else if (cmd === "log") {
      const days = Number(email ?? 30);
      const r = await db.query(`SELECT l.at, u.name, l.action, l.detail FROM commercial.access_log l JOIN ops.users u ON u.id = l.user_id
        WHERE l.at > now() - make_interval(days => $1) ORDER BY l.at DESC LIMIT 500`, [days]);
      console.table(r.rows.map((x) => ({ ...x, detail: JSON.stringify(x.detail) })));
    } else {
      console.log("Usage: list | add <email> [reason] [by] | remove <email> [reason] [by] | log [days]");
    }
  } finally {
    await db.end();
  }
}

main().catch((e) => reportFailure("commercial-access", e));
