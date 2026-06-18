import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import {
  User,
  Role,
  Folder,
  File,
  FolderPermission,
  FilePermission,
  SystemSetting,
  Permission,
  RolePermission,
  UserRole,
  FileAccessLog,
} from '../entities';
import { AccessRequest } from '../access-requests/access-request.entity';
import { ShareLink } from '../share-links/share-link.entity';

export default registerAs(
  'database',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'campus_repository',
    entities: [
      User,
      Role,
      Folder,
      File,
      FolderPermission,
      FilePermission,
      AccessRequest,
      SystemSetting,
      Permission,
      RolePermission,
      UserRole,
      ShareLink,
      FileAccessLog,
    ],
    synchronize: process.env.NODE_ENV !== 'production',
    logging: false,
  }),
);
