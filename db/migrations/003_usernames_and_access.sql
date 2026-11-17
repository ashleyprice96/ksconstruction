-- Usernames, forced password changes, office reset requests, and a
-- narrowly scoped function for named-list administrators.
-- ks_app is not granted access to commercial data or to this function.

ALTER TABLE ops.users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE ops.users ADD COLUMN username text;
ALTER TABLE ops.users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE ops.users ADD CONSTRAINT users_login_present CHECK (email IS NOT NULL OR username IS NOT NULL);
ALTER TABLE ops.users ADD CONSTRAINT users_username_shape CHECK (
  username IS NULL OR (length(username) BETWEEN 1 AND 64 AND username ~ '^[a-z0-9]+([.][a-z0-9]+|-[a-z0-9]+)*$')
);
CREATE UNIQUE INDEX users_username_lower ON ops.users (lower(username)) WHERE username IS NOT NULL;

-- Temporary passwords already handed out must be changed. Demo accounts are exempt.
UPDATE ops.users SET must_change_password = true
WHERE email IS NULL OR lower(email) NOT LIKE '%@demo.test';

CREATE TABLE ops.password_reset_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES ops.users(id),
  identifier text NOT NULL,
  ip text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES ops.users(id)
);
CREATE INDEX password_reset_requests_ip ON ops.password_reset_requests (ip, created_at);
CREATE INDEX password_reset_requests_identifier ON ops.password_reset_requests (lower(identifier), created_at);

-- The caller must already have set ks.user_id to themselves. The function
-- checks that person is an active administrator on the named list, then
-- changes the list. It runs as the migration owner, so ks_commercial does
-- not need write permission on the table.
CREATE FUNCTION commercial.manage_named_list(target uuid, op text, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = commercial, ops, pg_temp AS $$
DECLARE
  actor uuid := nullif(current_setting('ks.user_id', true), '')::uuid;
  actor_name text;
BEGIN
  IF op NOT IN ('add', 'remove') OR target IS NULL OR length(btrim(coalesce(reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Check the person and the reason.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ops.users u
    JOIN commercial.access_list a ON a.user_id = u.id
    WHERE u.id = actor AND u.role = 'admin' AND u.active
  ) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF actor = target AND op = 'remove' THEN
    RAISE EXCEPTION 'You cannot remove yourself.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ops.users WHERE id = target) THEN
    RAISE EXCEPTION 'That user does not exist.' USING ERRCODE = '22023';
  END IF;
  SELECT name INTO actor_name FROM ops.users WHERE id = actor;
  IF op = 'add' THEN
    INSERT INTO commercial.access_list (user_id, added_by, reason)
    VALUES (target, actor_name, btrim(reason))
    ON CONFLICT (user_id) DO NOTHING;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    INSERT INTO commercial.access_list_history (user_id, action, changed_by, reason)
    VALUES (target, 'added', actor_name, btrim(reason));
  ELSE
    DELETE FROM commercial.access_list WHERE user_id = target;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    INSERT INTO commercial.access_list_history (user_id, action, changed_by, reason)
    VALUES (target, 'removed', actor_name, btrim(reason));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION commercial.manage_named_list(uuid, text, text) FROM PUBLIC;

DO $priv$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ops.password_reset_requests TO ks_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ks_commercial') THEN
    GRANT EXECUTE ON FUNCTION commercial.manage_named_list(uuid, text, text) TO ks_commercial;
    GRANT SELECT ON commercial.access_list_history TO ks_commercial;
  END IF;
END
$priv$;
