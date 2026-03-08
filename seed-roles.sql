
INSERT INTO roles (id, name, description, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'super admin', 'Administrator with full access', NOW(), NOW()),
  (gen_random_uuid(), 'wd1', 'Wakil Dekan 1', NOW(), NOW()),
  (gen_random_uuid(), 'wd2', 'Wakil Dekan 2', NOW(), NOW()),
  (gen_random_uuid(), 'wd3', 'Wakil Dekan 3', NOW(), NOW()),
  (gen_random_uuid(), 'dosen', 'Dosen/Lecturer', NOW(), NOW()),
  (gen_random_uuid(), 'tendik', 'Tenaga Kependidikan/Staff', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;



