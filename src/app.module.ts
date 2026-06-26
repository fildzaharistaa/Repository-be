import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { FoldersModule } from './folders/folders.module';
import { FilesModule } from './files/files.module';
import { PermissionsModule } from './permissions/permissions.module';
import { AccessRequestsModule } from './access-requests/access-requests.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import jwtConfig from './config/jwt.config';
import { SearchModule } from './search/search.module';
import { StatsModule } from './stats/stats.module';
import { RecycleBinModule } from './recycle-bin/recycle-bin.module';
import { SettingsModule } from './settings/settings.module';
import { CronModule } from './cron/cron.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { ShareLinksModule } from './share-links/share-links.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [jwtConfig],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    FoldersModule,
    FilesModule,
    PermissionsModule,
    AccessRequestsModule,
    SearchModule,
    StatsModule,
    RecycleBinModule,
    SettingsModule,
    CronModule,
    SuperAdminModule,
    ShareLinksModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {} 
