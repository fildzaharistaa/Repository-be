-- ============================================================
-- Enterprise RBAC - Phase 1 Migration (idempotent, additive)
-- ============================================================
-- Adds: permissions, role_permissions, user_roles tables
-- Extends: roles table with audit/flags columns (additive)
-- Does NOT touch: users, folders, files, folder_permissions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ALTER roles: additive columns (default-safe, nullable)
-- ============================================================
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

-- ============================================================
-- TABLE: permissions
-- ============================================================
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

-- ============================================================
-- TABLE: role_permissions
-- ============================================================
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

-- ============================================================
-- TABLE: user_roles
-- ============================================================
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

-- Partial unique: 1 active assignment of (user, role) at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_active
    ON user_roles(user_id, role_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_roles_user_status ON user_roles(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_deleted_at ON user_roles(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================
-- Triggers: updated_at auto-update (only if helper function exists)
-- TypeORM @UpdateDateColumn already keeps these fresh at app level,
-- so triggers are optional and skipped if the helper isn't installed.
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_permissions_updated_at_trg') THEN
        CREATE TRIGGER update_permissions_updated_at_trg BEFORE UPDATE ON permissions
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_roles_updated_at_trg') THEN
        CREATE TRIGGER update_user_roles_updated_at_trg BEFORE UPDATE ON user_roles
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ============================================================
-- Verification
-- ============================================================
SELECT 'roles' AS table_name,
       (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='roles') AS columns;
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('permissions','role_permissions','user_roles')
ORDER BY table_name;
