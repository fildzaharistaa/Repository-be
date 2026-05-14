-- ============================================================
-- Role Workspace Isolation Migration
-- Run once: psql -d repository -f role-workspace-migration.sql
-- ============================================================

-- 1. Add role_id column to folders (nullable for backward compat)
ALTER TABLE folders ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE SET NULL;

-- 2. Populate from unit field (exact name match)
UPDATE folders f
SET role_id = r.id
FROM roles r
WHERE LOWER(r.name) = f.unit
  AND f.role_id IS NULL;

-- 3. Populate remaining from owner's primary role
UPDATE folders f
SET role_id = u.role_id
FROM users u
WHERE u.id = f.owner_id
  AND f.role_id IS NULL
  AND f.owner_id IS NOT NULL;

-- 4. Verify
SELECT
  COUNT(*) FILTER (WHERE role_id IS NOT NULL) AS folders_with_role,
  COUNT(*) FILTER (WHERE role_id IS NULL)     AS folders_without_role,
  COUNT(*)                                     AS total_folders
FROM folders;
