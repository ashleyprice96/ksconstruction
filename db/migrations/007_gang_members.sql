-- People in a gang, named by the gang lead. They do not get a login.
-- A claim split records how that claim's gang value is shared between them.

CREATE TABLE ops.gang_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gang_id uuid NOT NULL REFERENCES ops.gangs(id),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES ops.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX gang_members_name_unique ON ops.gang_members (gang_id, lower(name));

CREATE TABLE ops.member_splits (
  claim_id uuid NOT NULL REFERENCES ops.claims(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES ops.gang_members(id),
  basis text NOT NULL CHECK (basis IN ('amount', 'percent')),
  percent numeric(6,2),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  needs_confirm boolean NOT NULL DEFAULT false,
  PRIMARY KEY (claim_id, member_id)
);

-- Existing gangs keep their lead as a member. New demo gangs are added by the seed.
INSERT INTO ops.gang_members (gang_id, name)
SELECT id, btrim(ganger_name) FROM ops.gangs
WHERE length(btrim(ganger_name)) > 1
ON CONFLICT DO NOTHING;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ops.gang_members, ops.member_splits TO ks_app;
  END IF;
END
$priv$;
