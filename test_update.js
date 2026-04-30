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
  entities: [require('./src/entities/folder.entity').Folder, require('./src/entities/folder-permission.entity').FolderPermission, require('./src/entities/role.entity').Role, require('./src/entities/user.entity').User]
});

async function test() {
  await dataSource.initialize();
  
  const foldersService = require('./src/folders/folders.service').FoldersService;
  const fs = new foldersService(
    dataSource.getRepository('folders'),
    dataSource.getRepository('folder_permissions'),
    null,
    dataSource.getRepository('roles'),
    dataSource.getRepository('users'),
    null
  );
  
  const folder = await dataSource.getRepository('folders').findOne({where: {}});
  console.log('Testing with folder', folder.id);
  
  try {
    await fs.update(folder.id, {
      share_with_roles: ['Wakil Dekan 2', 'Dosen', 'Tendik']
    });
    console.log('Update success');
  } catch(e) {
    console.log('Update error:', e.stack);
  }

  await dataSource.destroy();
}
test().catch(console.error);
