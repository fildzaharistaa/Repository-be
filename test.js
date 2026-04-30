const { DataSource } = require('typeorm');
const dotenv = require('dotenv');
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
  const roles = await dataSource.query('SELECT * FROM roles');
  console.log('Roles:', roles);
  await dataSource.destroy();
}
test().catch(console.error);
