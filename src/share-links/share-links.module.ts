import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ShareLinksService } from './share-links.service';
import { ShareLinksController } from './share-links.controller';
import { ShareLink } from './share-link.entity';
import { File } from '../entities/file.entity';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShareLink, File, Folder, User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret') || process.env.JWT_SECRET || 'default-secret-key',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [ShareLinksController],
  providers: [ShareLinksService],
  exports: [ShareLinksService],
})
export class ShareLinksModule {}
