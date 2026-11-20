-- Who entered a claim when the office fills it in for a gang lead.
ALTER TABLE ops.claims
  ADD COLUMN IF NOT EXISTS entered_by_user_id uuid REFERENCES ops.users(id),
  ADD COLUMN IF NOT EXISTS entered_at timestamptz;
