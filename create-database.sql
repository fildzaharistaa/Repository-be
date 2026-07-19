-- ============================================
-- Campus Repository System - Database Schema
-- ============================================
-- This script creates the complete database structure
-- Run this script to set up a new database

-- Create database (run this separately if needed)
-- CREATE DATABASE campus_repository;
-- \c campus_repository;

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- TABLE: roles
-- ============================================
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    description VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- TABLE: users
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role_id UUID,
    unit VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL
);

-- ============================================
-- TABLE: folders
-- ============================================
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    parent_id UUID,
    unit VARCHAR(50) DEFAULT 'general',
    owner_id UUID,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    CONSTRAINT fk_folders_parent FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE SET NULL,
    CONSTRAINT fk_folders_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================
-- TABLE: files
-- ============================================
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    size BIGINT NOT NULL,
    folder_id UUID NOT NULL,
    owner_id UUID,
    uploaded_by_role_id UUID,
    last_accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    CONSTRAINT fk_files_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    CONSTRAINT fk_files_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_files_uploaded_by_role FOREIGN KEY (uploaded_by_role_id) REFERENCES roles(id) ON DELETE SET NULL
);

-- ============================================
-- TABLE: access_requests
-- ============================================
CREATE TABLE IF NOT EXISTS access_requests (
    id SERIAL PRIMARY KEY,
    requester_id UUID NOT NULL,
    folder_id UUID,
    file_id UUID,
    owner_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    message VARCHAR(500),
    response_message VARCHAR(500),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_access_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_access_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    CONSTRAINT fk_access_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    CONSTRAINT fk_access_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_access_target CHECK (
        (folder_id IS NOT NULL AND file_id IS NULL) OR 
        (folder_id IS NULL AND file_id IS NOT NULL)
    )
);

-- ============================================
-- TABLE: folder_permissions
-- ============================================
CREATE TABLE IF NOT EXISTS folder_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    folder_id UUID NOT NULL,
    user_id UUID,
    role_id UUID,
    can_read BOOLEAN NOT NULL DEFAULT false,
    can_create BOOLEAN NOT NULL DEFAULT false,
    can_update BOOLEAN NOT NULL DEFAULT false,
    can_delete BOOLEAN NOT NULL DEFAULT false,
    can_download BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_permissions_folder FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
    CONSTRAINT fk_permissions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT chk_permissions_user_or_role CHECK (
        (user_id IS NOT NULL AND role_id IS NULL) OR 
        (user_id IS NULL AND role_id IS NOT NULL)
    )
);

-- ============================================
-- INDEXES for better performance
-- ============================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);

-- Folders indexes
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_deleted_at ON folders(deleted_at) WHERE deleted_at IS NULL;

-- Files indexes
CREATE INDEX IF NOT EXISTS idx_files_folder_id ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at) WHERE deleted_at IS NULL;

-- Permissions indexes
CREATE INDEX IF NOT EXISTS idx_permissions_folder_id ON folder_permissions(folder_id);
CREATE INDEX IF NOT EXISTS idx_permissions_user_id ON folder_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_permissions_role_id ON folder_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_permissions_expires_at ON folder_permissions(expires_at) WHERE expires_at IS NOT NULL;

-- Composite index for permission lookups
CREATE INDEX IF NOT EXISTS idx_permissions_lookup ON folder_permissions(folder_id, user_id, role_id, expires_at);

-- ============================================
-- SEED DATA: Roles
-- ============================================
INSERT INTO roles (id, name, description, created_at, updated_at)
VALUES
    (uuid_generate_v4(), 'Super Admin', 'Administrator with full access', NOW(), NOW()),
    (uuid_generate_v4(), 'Dekan', 'Dekan Fakultas', NOW(), NOW()),
    (uuid_generate_v4(), 'Wakil Dekan 1', 'Wakil Dekan 1', NOW(), NOW()),
    (uuid_generate_v4(), 'Wakil Dekan 2', 'Wakil Dekan 2', NOW(), NOW()),
    (uuid_generate_v4(), 'Wakil Dekan 3', 'Wakil Dekan 3', NOW(), NOW()),
    (uuid_generate_v4(), 'Koordinator Prodi', 'Koordinator Program Studi', NOW(), NOW()),
    (uuid_generate_v4(), 'Koordinator Jurusan', 'Koordinator Jurusan', NOW(), NOW()),
    (uuid_generate_v4(), 'Dosen', 'Dosen/Lecturer', NOW(), NOW()),
    (uuid_generate_v4(), 'Tendik', 'Tenaga Kependidikan/Staff', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- RBAC: roles flags + permissions/role_permissions/user_roles
-- ============================================
-- Additive & idempotent — safe on a fresh install AND on a database that
-- already has the base schema (uses IF NOT EXISTS / ON CONFLICT throughout),
-- so this never needs to be run as a separate manual step.

ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS hierarchy_level INT NOT NULL DEFAULT 0;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS color VARCHAR(20);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_roles_is_active ON roles(is_active);
CREATE INDEX IF NOT EXISTS idx_roles_deleted_at ON roles(deleted_at) WHERE deleted_at IS NULL;

-- Mark Super Admin (and any admin-name variant) as the system admin role
UPDATE roles
   SET is_admin = true, is_system = true
 WHERE LOWER(REPLACE(name, ' ', '_')) IN ('admin', 'super_admin', 'superadmin');

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug VARCHAR(100) NOT NULL UNIQUE,
    module VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    submodule VARCHAR(50),
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500),
    category VARCHAR(50),
    visibility VARCHAR(20) NOT NULL DEFAULT 'internal',
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    created_by UUID,
    updated_by UUID,
    CONSTRAINT chk_permissions_visibility CHECK (visibility IN ('internal','public','hidden'))
);

CREATE INDEX IF NOT EXISTS idx_permissions_module_action ON permissions(module, action);
CREATE INDEX IF NOT EXISTS idx_permissions_category ON permissions(category);
CREATE INDEX IF NOT EXISTS idx_permissions_is_active ON permissions(is_active);
CREATE INDEX IF NOT EXISTS idx_permissions_deleted_at ON permissions(deleted_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL,
    permission_id UUID NOT NULL,
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by UUID,
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    CONSTRAINT uq_role_permission UNIQUE (role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    role_id UUID NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(25) NOT NULL DEFAULT 'ACTIVE',
    suspended_reason VARCHAR(500),
    expires_at TIMESTAMP,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    assigned_by UUID,
    suspended_at TIMESTAMP,
    reactivated_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP,
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
    CONSTRAINT chk_user_roles_status CHECK (status IN ('ACTIVE','SUSPENDED','PENDING_REACTIVATION'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_active
    ON user_roles(user_id, role_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_user_status ON user_roles(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_deleted_at ON user_roles(deleted_at) WHERE deleted_at IS NULL;

-- ============================================
-- SEED DATA: Core system permissions
-- ============================================
-- Every permission slug actually referenced by @RequirePermissions(...) in the
-- backend, plus the view/update/download counterparts for completeness.
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
    (uuid_generate_v4(), 'file.view',              'file',       'view',              'View File',               'Lihat/preview file',                        'file',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'file.upload',            'file',       'upload',            'Upload File',             'Upload file',                               'file',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'file.download',          'file',       'download',          'Download File',           'Download file',                             'file',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'file.delete',            'file',       'delete',            'Delete File',             'Hapus file',                                'file',  'internal', true, true, NOW(), NOW()),
    (uuid_generate_v4(), 'audit.view',             'audit',      'view',              'View Audit Logs',         'Lihat audit log sistem',                    'audit', 'internal', true, true, NOW(), NOW())
ON CONFLICT (slug) DO NOTHING;

-- Grant every permission to every admin role (is_admin = true)
INSERT INTO role_permissions (role_id, permission_id, granted_at)
SELECT r.id, p.id, NOW()
FROM roles r
CROSS JOIN permissions p
WHERE r.is_admin = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Backfill user_roles from users.role_id (no-op on a fresh install with no users yet)
INSERT INTO user_roles (id, user_id, role_id, is_primary, status, assigned_at, created_at, updated_at)
SELECT uuid_generate_v4(), u.id, u.role_id, true, 'ACTIVE', NOW(), NOW(), NOW()
FROM users u
WHERE u.role_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = u.id AND ur.role_id = u.role_id AND ur.deleted_at IS NULL
  );

-- ============================================
-- TRIGGERS: Auto-update updated_at timestamp
-- ============================================

-- Function to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_folders_updated_at BEFORE UPDATE ON folders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON files
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_permissions_updated_at BEFORE UPDATE ON folder_permissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_rbac_permissions_updated_at_trg') THEN
        CREATE TRIGGER update_rbac_permissions_updated_at_trg BEFORE UPDATE ON permissions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_roles_updated_at_trg') THEN
        CREATE TRIGGER update_user_roles_updated_at_trg BEFORE UPDATE ON user_roles
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check if tables are created
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name IN ('roles', 'users', 'folders', 'files', 'folder_permissions')
ORDER BY table_name;

-- Check roles
SELECT id, name, description FROM roles ORDER BY name;

-- ============================================
-- NOTES
-- ============================================
-- 1. Database name: campus_repository
-- 2. All IDs use UUID (v4)
-- 3. Soft deletes are implemented for folders and files
-- 4. Foreign keys have appropriate CASCADE/SET NULL behavior
-- 5. Indexes are created for common query patterns
-- 6. Triggers automatically update updated_at timestamps

