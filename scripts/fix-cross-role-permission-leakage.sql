-- ============================================================
-- Migration: Fix Cross-Role Permission Leakage
-- ============================================================
-- Context:
--   Previously, folder creation automatically saved a user-level permission
--   with role_id = NULL for the creator:
--     { folder_id: X, user_id: creator_id, role_id: NULL, can_read: true, ... }
--   A NULL role_id means "accessible in any role context", so this permission
--   matched getSharedTree()'s query for ALL of the creator's roles, causing
--   private folders to appear in Shared Folders for roles that should have
--   no visibility.
--
-- Fix applied in code (prevents new leakage):
--   - folders.service.ts create(): no longer creates null-role user permission.
--   - getSharedTree(): private-role folders are now filtered by role_id, not owner_id.
--   - getSharedTree() / getAccessibleFolderIds(): userPerms query JOINs folders/roles to
--     exclude private-workspace folders from other role contexts even with role_id=NULL grants.
--   - checkPermission(): private folder access now requires matching roleId AND userId.
--   - getUserStats(): uses shared getAccessibleFolderIds() helper with correct owner_id filter.
--
-- This script cleans up EXISTING data.
-- Run ONCE after deploying the code fix.
-- ============================================================

BEGIN;

-- Step 1: Preview — rows that will be deleted
-- (null-role user permissions on private-role folders)
SELECT
  fp.id,
  fp.folder_id,
  fp.user_id,
  f.owner_id,
  f.role_id AS folder_workspace_role,
  r.name    AS role_name,
  r.is_private
FROM folder_permissions fp
JOIN folders f ON f.id = fp.folder_id
JOIN roles   r ON r.id = f.role_id
WHERE fp.user_id IS NOT NULL
  AND fp.role_id IS NULL
  AND r.is_private = true
  AND f.deleted_at IS NULL
ORDER BY fp.folder_id;

-- Step 2: Delete ALL null-role user permissions on private-role folders.
-- Private folders should never carry role-agnostic (role_id=NULL) user grants because
-- those grants are visible in any role context, breaking per-(user,role) isolation.
DELETE FROM folder_permissions
WHERE user_id IS NOT NULL
  AND role_id IS NULL
  AND folder_id IN (
    SELECT f.id
    FROM folders f
    INNER JOIN roles r ON r.id = f.role_id
    WHERE r.is_private = true
      AND f.deleted_at IS NULL
  );

-- Step 3: Verify no null-role user permissions remain on private-role folders
SELECT COUNT(*) AS remaining_null_role_private_perms
FROM folder_permissions fp
JOIN folders f ON f.id = fp.folder_id
JOIN roles   r ON r.id = f.role_id
WHERE fp.user_id IS NOT NULL
  AND fp.role_id IS NULL
  AND r.is_private = true
  AND f.deleted_at IS NULL;

COMMIT;
