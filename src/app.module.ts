import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
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
import { ChatbotModule } from './chatbot/chatbot.module';
import { AccessRequestsModule } from './access-requests/access-requests.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import { SearchModule } from './search/search.module';
import { StatsModule } from './stats/stats.module';
import { RecycleBinModule } from './recycle-bin/recycle-bin.module';
import { SettingsModule } from './settings/settings.module';
import { CronModule } from './cron/cron.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { ShareLinksModule } from './share-links/share-links.module';
import { IntegrationModule } from './integration/integration.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        configService.get<TypeOrmModuleOptions>('database')!,
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    RolesModule,
    FoldersModule,
    FilesModule,
    PermissionsModule,
    ChatbotModule,
    AccessRequestsModule,
    SearchModule,
    StatsModule,
    RecycleBinModule,
    SettingsModule,
    CronModule,
    SuperAdminModule,
    ShareLinksModule,
    IntegrationModule,
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
