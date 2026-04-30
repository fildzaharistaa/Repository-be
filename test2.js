const { DataSource } = require('typeorm');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
dotenv.config();

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'campus_repository',
});

async function test() {
  await dataSource.initialize();
  console.log('Connected to DB');
  
  // Find an existing folder
  const folders = await dataSource.query('SELECT * FROM folders LIMIT 1');
  if (folders.length === 0) {
     console.log('No folders');
     return;
  }
  const folder = folders[0];
  console.log('Using folder:', folder.id);

  // Find dosen role
  const roles = await dataSource.query(`SELECT * FROM roles WHERE name = 'dosen'`);
  if (roles.length === 0) return;
  const dosenRole = roles[0];
  console.log('Using role:', dosenRole.id);

  try {
    const res = await dataSource.query(
      `INSERT INTO folder_permissions (id, folder_id, role_id, can_read, can_create, can_update, can_delete, can_download, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
       [uuidv4(), folder.id, dosenRole.id, true, true, true, true, true]
    );
    console.log('Insert success');
  } catch(e) {
    console.log('Insert error:', e.message);
  }

  await dataSource.destroy();
}
test().catch(console.error);
