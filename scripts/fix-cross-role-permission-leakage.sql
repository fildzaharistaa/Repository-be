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
--   - getSharedTree(): filters out folders owned by the requesting user.
--   - All permission checks now use active_role_id instead of user.role_id.
--
-- This script cleans up EXISTING data.
-- Run ONCE after deploying the code fix.
-- REVIEW CAREFULLY before executing.
-- ============================================================

BEGIN;

-- Step 1: Identify null-role owner permissions that are redundant
-- (owner already has access via a role-level permission on the same folder)
SELECT
  fp.id,
  fp.folder_id,
  fp.user_id,
  f.owner_id,
  f.role_id AS folder_workspace_role
FROM folder_permissions fp
JOIN folders f ON f.id = fp.folder_id
WHERE fp.user_id IS NOT NULL
  AND fp.role_id IS NULL
  AND fp.user_id = f.owner_id          -- permission belongs to the folder owner
  AND EXISTS (                          -- a role-level permission also exists for this folder
    SELECT 1
    FROM folder_permissions fp2
    WHERE fp2.folder_id = fp.folder_id
      AND fp2.role_id IS NOT NULL
      AND fp2.user_id IS NULL
  )
ORDER BY fp.folder_id;

-- Step 2 (EXECUTE ONLY AFTER REVIEWING STEP 1 OUTPUT):
-- Delete the redundant null-role owner permissions.
-- Uncomment and run when satisfied with the above SELECT.

-- DELETE FROM folder_permissions
-- WHERE user_id IS NOT NULL
--   AND role_id IS NULL
--   AND user_id = (
--     SELECT owner_id FROM folders WHERE id = folder_id
--   )
--   AND EXISTS (
--     SELECT 1 FROM folder_permissions fp2
--     WHERE fp2.folder_id = folder_permissions.folder_id
--       AND fp2.role_id IS NOT NULL
--       AND fp2.user_id IS NULL
--   );

-- Step 3: Verify no more null-role owner permissions remain
-- SELECT COUNT(*) AS remaining_null_role_owner_perms
-- FROM folder_permissions fp
-- JOIN folders f ON f.id = fp.folder_id
-- WHERE fp.user_id IS NOT NULL
--   AND fp.role_id IS NULL
--   AND fp.user_id = f.owner_id;

ROLLBACK; -- Change to COMMIT after reviewing and uncommenting DELETE above
