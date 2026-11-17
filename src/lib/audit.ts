import "server-only";
import type { PoolClient } from "pg";
import { q } from "./db";

export async function audit(
  userId: string | null, entity: string, entityId: string, action: string,
  details: Record<string, unknown> = {}, client?: PoolClient,
) {
  const sql = "INSERT INTO ops.audit_log (user_id, entity, entity_id, action, details) VALUES ($1, $2, $3, $4, $5)";
  const params = [userId, entity, entityId, action, JSON.stringify(details)];
  if (client) await client.query(sql, params);
  else await q(sql, params);
}
