require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'repository',
});

const email    = process.env.ADMIN_EMAIL    || 'superadmin@repository.com';
const password = process.env.ADMIN_PASSWORD || 'SuperAdmin123!';
const name     = process.env.ADMIN_NAME     || 'Super Admin';

async function run() {
  try {
    // Cari role: super admin → admin (fallback)
    let roleResult = await pool.query(
      `SELECT id, name FROM roles WHERE LOWER(REPLACE(name,' ','_')) IN ('super_admin','superadmin') LIMIT 1`
    );
    if (roleResult.rows.length === 0) {
      roleResult = await pool.query(`SELECT id, name FROM roles WHERE name = 'admin' LIMIT 1`);
    }
    if (roleResult.rows.length === 0) {
      console.error('❌ Tidak ada role admin/super admin. Jalankan create-database.sql dulu.');
      process.exit(1);
    }
    const role = roleResult.rows[0];

    // Cek user sudah ada
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.log('⚠️  User sudah ada:', email);
      process.exit(0);
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password, name, role_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, email, name`,
      [email, hashed, name, role.id]
    );

    const user = result.rows[0];
    console.log('\n✅ Akun berhasil dibuat!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('ID    :', user.id);
    console.log('Nama  :', user.name);
    console.log('Email :', user.email);
    console.log('Role  :', role.name);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Login dengan:');
    console.log('  Email   :', email);
    console.log('  Password:', password);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
