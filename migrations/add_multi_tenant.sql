-- Migration script: Add multi-tenant support to existing AuthKit databases
-- This script migrates existing users to the new organization-based model
--
-- Run with: psql $DATABASE_URL < migrations/add_multi_tenant.sql
-- Or with SQLite: sqlite3 database.db < migrations/add_multi_tenant.sql

-- =============================================================================
-- 1. CREATE ORG TABLES (if running on existing database)
-- =============================================================================

-- Note: These are already created by AuthKit 0.3.0 init(), but included here
-- for reference and manual migration scenarios

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS org_memberships (
  user_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS org_entitlements (
  org_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, app_name)
);

-- Indexes for PostgreSQL
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON org_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON org_memberships(org_id);
CREATE INDEX IF NOT EXISTS idx_org_entitlements_org ON org_entitlements(org_id);

-- =============================================================================
-- 2. MIGRATE EXISTING USERS TO ORGANIZATIONS
-- =============================================================================

-- PostgreSQL version (uses DO block)
DO $$
DECLARE
  user_record RECORD;
  new_org_id TEXT;
BEGIN
  -- Loop through all existing users who don't have an org yet
  FOR user_record IN
    SELECT u.id, u.email, u.username, u.created_at
    FROM users u
    WHERE NOT EXISTS (
      SELECT 1 FROM org_memberships m WHERE m.user_id = u.id
    )
  LOOP
    -- Generate org ID
    new_org_id := 'org_' || user_record.id;

    -- Create organization for this user
    INSERT INTO organizations (id, name, owner_user_id, created_at)
    VALUES (
      new_org_id,
      COALESCE(user_record.username, user_record.email) || '''s Workspace',
      user_record.id,
      COALESCE(user_record.created_at, NOW())
    )
    ON CONFLICT (id) DO NOTHING;

    -- Add user as owner of their org
    INSERT INTO org_memberships (user_id, org_id, role, joined_at)
    VALUES (
      user_record.id,
      new_org_id,
      'owner',
      COALESCE(user_record.created_at, NOW())
    )
    ON CONFLICT (user_id, org_id) DO NOTHING;

    -- Grant FastTask entitlement (default app)
    INSERT INTO org_entitlements (org_id, app_name, granted_at)
    VALUES (new_org_id, 'fast_task', NOW())
    ON CONFLICT (org_id, app_name) DO NOTHING;

    RAISE NOTICE 'Migrated user % to org %', user_record.email, new_org_id;
  END LOOP;
END $$;

-- =============================================================================
-- 3. VERIFICATION QUERIES
-- =============================================================================

-- Check migration results
SELECT
  'Total users' as metric,
  COUNT(*) as count
FROM users
UNION ALL
SELECT
  'Total orgs' as metric,
  COUNT(*) as count
FROM organizations
UNION ALL
SELECT
  'Total memberships' as metric,
  COUNT(*) as count
FROM org_memberships
UNION ALL
SELECT
  'Total entitlements' as metric,
  COUNT(*) as count
FROM org_entitlements;

-- Show sample data
SELECT
  u.email,
  o.name as org_name,
  m.role,
  STRING_AGG(e.app_name, ', ') as apps
FROM users u
LEFT JOIN org_memberships m ON m.user_id = u.id
LEFT JOIN organizations o ON o.id = m.org_id
LEFT JOIN org_entitlements e ON e.org_id = o.id
GROUP BY u.email, o.name, m.role
LIMIT 10;
