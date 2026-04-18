import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getAll() {
    return this.settingsService.getAll();
  }

  @Get(':key')
  async getByKey(@Param('key') key: string) {
    const value = await this.settingsService.get(key);
    return { key, value };
  }

  @Patch(':key')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(
    @Param('key') key: string,
    @Body('value') value: string,
  ) {
    return this.settingsService.update(key, value);
  }
}
