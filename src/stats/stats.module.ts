import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatsController } from './stats.controller';
import { Role, User, Folder, File, SystemSetting } from '../entities';

@Module({
  imports: [TypeOrmModule.forFeature([Role, User, Folder, File, SystemSetting])],
  controllers: [StatsController],
})
export class StatsModule {}
