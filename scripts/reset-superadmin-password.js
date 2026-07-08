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

async function run() {
  const email = 'superadmin@repository.com';
  const newPassword = 'SuperAdmin123!';
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const r = await pool.query(
      'UPDATE users SET password=$1, updated_at=NOW() WHERE email=$2 RETURNING id, email, name',
      [hash, email]
    );
    if (r.rows.length > 0) {
      console.log('\n✅ Password berhasil direset!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Email   :', r.rows[0].email);
      console.log('Nama    :', r.rows[0].name);
      console.log('Password: SuperAdmin123!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } else {
      console.log('❌ User tidak ditemukan:', email);
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
  }
}

run();
