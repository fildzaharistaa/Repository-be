-- ============================================================
-- Enterprise RBAC - Phase 1 Seed (idempotent)
-- ============================================================
-- - Ensures a super-admin role with is_admin=true, is_system=true
-- - Inserts core system permissions
-- - Grants every permission to the super-admin role
-- - Backfills user_roles from existing users.role_id
-- ============================================================

-- ----------- Ensure super_admin role -------------------------
INSERT INTO roles (id, name, description, is_admin, is_active, is_system, hierarchy_level, category, color, created_at, updated_at)
VALUES (uuid_generate_v4(), 'super_admin', 'Super Administrator with full system access', true, true, true, 999, 'admin', '#dc2626', NOW(), NOW())
ON CONFLICT (name) DO UPDATE
    SET is_admin = true,
        is_system = true,
        is_active = true,
        hierarchy_level = GREATEST(roles.hierarchy_level, 999);

-- Also harmonize any pre-existing super-admin / admin role variants
UPDATE roles
   SET is_admin = true, is_system = true
 WHERE LOWER(REPLACE(name, ' ', '_')) IN ('admin','super_admin','superadmin');

-- ----------- Core system permissions -------------------------
INSERT INTO permissions (id, slug, module, action, name, description, category, visibility, is_system, is_active, created_at, updated_at) VALUES
    (uuid_generate_v4(), 'role.view',              'role',       'view',              'View Roles',              'Lihat daftar dan detail role',              'rbac',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'role.manage',            'role',       'manage',            'Manage Roles',            'Buat, ubah, hapus, clone role',             'rbac',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'permission.view',        'permission', 'view',              'View Permissions',        'Lihat daftar permission',                   'rbac',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'permission.manage',      'permission', 'manage',            'Manage Permissions',      'Buat, ubah, hapus permission',              'rbac',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'user.view',              'user',       'view',              'View Users',              'Lihat daftar user',                         'user',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'user.manage',            'user',       'manage',            'Manage Users',            'Buat, ubah, hapus user dan role assignment','user',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'folder.view',            'folder',     'view',              'View Folders',            'Lihat folder',                              'folder','internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'folder.create',          'folder',     'create',            'Create Folder',           'Buat folder baru',                          'folder','internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'folder.update',          'folder',     'update',            'Update Folder',           'Ubah folder',                               'folder','internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'folder.delete',          'folder',     'delete',            'Delete Folder',           'Hapus folder',                              'folder','internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'folder.download',        'folder',     'download',          'Download Folder',         'Download isi folder',                       'folder','internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'folder.create_subfolder','folder',     'create_subfolder',  'Create Subfolder',        'Buat subfolder',                            'folder','internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'file.upload',            'file',       'upload',            'Upload File',             'Upload file',                               'file',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'file.download',          'file',       'download',          'Download File',           'Download file',                             'file',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'file.delete',            'file',       'delete',            'Delete File',             'Hapus file',                                'file',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'audit.view',             'audit',      'view',              'View Audit Logs',         'Lihat audit log sistem',                    'audit', 'internal', true, true, NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

-- ----------- Grant ALL permissions to every admin role --------
INSERT INTO role_permissions (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.is_admin = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ----------- Backfill user_roles from users.role_id -----------
INSERT INTO user_roles (id, user_id, role_id, is_primary, status, assigned_at, created_at, updated_at)
SELECT uuid_generate_v4(), u.id, u.role_id, true, 'ACTIVE', NOW(), NOW(), NOW()
FROM users u
WHERE u.role_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = u.role_id AND ur.deleted_at IS NULL
  );

-- ----------- Verification ------------------------------------
SELECT 'roles' AS kind, COUNT(*) FROM roles
UNION ALL SELECT 'permissions', COUNT(*) FROM permissions
UNION ALL SELECT 'role_permissions', COUNT(*) FROM role_permissions
UNION ALL SELECT 'user_roles', COUNT(*) FROM user_roles;
