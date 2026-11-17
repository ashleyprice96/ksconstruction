-- A deleted claim stays in the database for the audit trail and for restore.
-- deleted_at hides it from lists, totals and the lift cap.

ALTER TABLE ops.claims
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES ops.users(id),
  ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE ops.claims DROP CONSTRAINT IF EXISTS claims_delete_reason;
ALTER TABLE ops.claims ADD CONSTRAINT claims_delete_reason
  CHECK (deleted_at IS NULL OR (deleted_by IS NOT NULL AND length(btrim(delete_reason)) >= 3));

CREATE INDEX IF NOT EXISTS claims_deleted_at ON ops.claims (deleted_at) WHERE deleted_at IS NOT NULL;

-- Margin figures must ignore a deleted claim. Column list is unchanged.
CREATE OR REPLACE VIEW commercial.claim_line_values WITH (security_barrier) AS
SELECT
  l.id AS claim_line_id,
  c.id AS claim_id,
  c.ref,
  c.client_id,
  c.site_id,
  c.gang_id,
  c.week_ending,
  c.work_date,
  c.claim_type,
  c.status,
  l.description,
  l.quantity,
  l.gang_value,
  coalesce(
    (SELECT r.rate FROM commercial.client_rates r
      WHERE l.item_id IS NOT NULL AND r.item_id = l.item_id AND r.client_id = c.client_id
        AND (r.site_id = c.site_id OR r.site_id IS NULL) AND r.effective_from <= c.work_date
      ORDER BY (r.site_id IS NULL), r.effective_from DESC LIMIT 1),
    NULL) AS client_rate,
  CASE
    WHEN l.item_id IS NOT NULL THEN round(l.quantity * (
      SELECT r.rate FROM commercial.client_rates r
      WHERE r.item_id = l.item_id AND r.client_id = c.client_id
        AND (r.site_id = c.site_id OR r.site_id IS NULL) AND r.effective_from <= c.work_date
      ORDER BY (r.site_id IS NULL), r.effective_from DESC LIMIT 1), 2)
    WHEN l.lift_id IS NOT NULL THEN round(l.quantity / 100 * (
      SELECT v.value FROM commercial.client_lift_values v
      WHERE v.lift_id = l.lift_id AND v.client_id = c.client_id AND v.effective_from <= c.work_date
      ORDER BY v.effective_from DESC LIMIT 1), 2)
    WHEN l.supervision_assignment_id IS NOT NULL THEN round(l.quantity * (
      SELECT s.weekly_charge FROM commercial.client_supervision_charges s
      WHERE s.assignment_id = l.supervision_assignment_id), 2)
  END AS client_value
FROM ops.claim_lines l
JOIN ops.claims c ON c.id = l.claim_id
WHERE commercial.is_named_user() AND c.deleted_at IS NULL;
