require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const repoPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'repository',
});

const ikupkPool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: 'iku_pk',
});

// Mapping IKUPK role → Repository role name
const ROLE_MAP = {
  'SuperAdmin':        'Super Admin',
  'Admin':             'Super Admin',
  'Dekan':             null,
  'Wakil Dekan 1':     'Wakil Dekan 1',
  'Wakil Dekan 2':     'Wakil Dekan 2 Bid.SDM',
  'Wakil Dekan 3':     'Wakil Dekan 3',
  'Kepala Jurusan':    'Ketua Jurusan',
  'Koordinator Prodi': 'Koordinator Prodi',
  'Dosen':             'Dosen',
  'Tendik':            'Tendik',
};

const UNIT_MAP = {
  'Super Admin':           'superadmin',
  'Wakil Dekan 1':         'wd1',
  'Wakil Dekan 2 Bid.SDM': 'sdm',
  'Wakil Dekan 3':         'wd3',
  'Ketua Jurusan':         'jurusan',
  'Koordinator Prodi':     'prodi',
  'Dosen':                 'dosen',
  'Tendik':                'tendik',
  'Kepala Bagian TU':      'tu',
};

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || 'Password123!';

async function run() {
  console.log('Memulai seed users dari IKUPK ke Repository...\n');

  const repoRolesRes = await repoPool.query('SELECT id, name FROM roles WHERE deleted_at IS NULL');
  const repoRoleByName = {};
  repoRolesRes.rows.forEach(r => { repoRoleByName[r.name] = r.id; });
  const dosenRoleId = repoRoleByName['Dosen'];

  const ikupkUsers = await ikupkPool.query(`
    SELECT u.id, u.nama, u.email, r.name as role_name
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_primary = true
    LEFT JOIN roles r ON r.id = ur.role_id
    ORDER BY u.email
  `);

  const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  let created = 0, skipped = 0, failed = 0;

  for (const u of ikupkUsers.rows) {
    const ikupkRole = u.role_name || 'Dosen';
    const repoRoleName = ROLE_MAP[ikupkRole] ?? null;
    const roleId = repoRoleName ? (repoRoleByName[repoRoleName] ?? dosenRoleId) : dosenRoleId;
    const resolvedRoleName = repoRoleName ?? 'Dosen';
    const unit = UNIT_MAP[resolvedRoleName] ?? 'dosen';

    try {
      const existing = await repoPool.query('SELECT id FROM users WHERE email = $1', [u.email]);
      if (existing.rows.length > 0) {
        console.log(`SKIP  ${u.email} (sudah ada)`);
        skipped++;
        continue;
      }
      await repoPool.query(
        'INSERT INTO users (email, password, name, role_id, unit, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [u.email, hashed, u.nama, roleId, unit]
      );
      console.log(`OK    ${u.email.padEnd(40)} | ${ikupkRole} -> ${resolvedRoleName}`);
      created++;
    } catch (e) {
      console.log(`ERROR ${u.email} | ${e.message}`);
      failed++;
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Dibuat   : ${created}`);
  console.log(`Dilewati : ${skipped}`);
  console.log(`Gagal    : ${failed}`);
  console.log(`Password : ${DEFAULT_PASSWORD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await repoPool.end();
  await ikupkPool.end();
}

run().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
