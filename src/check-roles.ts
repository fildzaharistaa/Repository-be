import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from './entities/role.entity';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const roleRepo = app.get(getRepositoryToken(Role));
  const roles = await roleRepo.find();
  console.log('--- ACTUAL ROLES IN DATABASE ---');
  roles.forEach(r => console.log(`- "${r.name}"`));
  console.log('--------------------------------');
  await app.close();
}
bootstrap();
