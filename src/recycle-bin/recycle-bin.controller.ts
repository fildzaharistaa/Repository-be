import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { RecycleBinService } from './recycle-bin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';

@Controller('recycle-bin')
@UseGuards(JwtAuthGuard)
export class RecycleBinController {
  constructor(private readonly recycleBinService: RecycleBinService) {}

  @Get()
  async findAllTrashed(@Request() req: RequestWithUser) {
    const isAdmin = req.user.role?.name === 'admin';
    return this.recycleBinService.findAllTrashed(req.user.id, isAdmin);
  }

  @Patch('restore/file/:id')
  async restoreFile(@Param('id') id: string) {
    await this.recycleBinService.restoreFile(id);
    return { message: 'File restored successfully' };
  }

  @Patch('restore/folder/:id')
  async restoreFolder(@Param('id') id: string) {
    await this.recycleBinService.restoreFolder(id);
    return { message: 'Folder and its contents restored successfully' };
  }

  @Delete('file/:id')
  async permanentDeleteFile(@Param('id') id: string) {
    await this.recycleBinService.permanentDeleteFile(id);
    return { message: 'File permanently deleted' };
  }

  @Delete('folder/:id')
  async permanentDeleteFolder(@Param('id') id: string) {
    await this.recycleBinService.permanentDeleteFolder(id);
    return { message: 'Folder and its contents permanently deleted' };
  }
}
