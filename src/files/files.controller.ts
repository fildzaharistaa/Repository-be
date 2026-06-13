import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Delete,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  Res,
  Header,
  Headers,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FilesService } from './files.service';
import { SettingsService } from '../settings/settings.service';
import { UpdateFileDto } from './update-file.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post('upload/:folderId')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 500 * 1024 * 1024 }, // hard cap 500 MB at Multer level
    }),
  )
  async uploadFile(
    @Param('folderId') folderId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: RequestWithUser,
  ) {
    const maxSize = await this.settingsService.getMaxUploadSize();
    if (file.size > maxSize) {
      fs.unlink(file.path, () => {}); // cleanup orphan file from disk
      const maxMB = (maxSize / (1024 * 1024)).toFixed(0);
      throw new BadRequestException(`File melebihi batas maksimum ${maxMB}MB`);
    }
    return this.filesService.create(file, folderId, req.user);
  }

  @Get('folder/:folderId')
  async findAll(
    @Param('folderId') folderId: string,
    @Request() req: RequestWithUser,
  ) {
    return this.filesService.findAll(folderId, req.user);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req: RequestWithUser) {
    return this.filesService.findOne(id, req.user);
  }

  @Get(':id/preview')
  async preview(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
    @Res() res: Response,
    @Headers('range') range?: string,
  ) {
    const file = await this.filesService.checkPreviewPermission(id, req.user);

    if (!fs.existsSync(file.path)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }

    const stat = fs.statSync(file.path);
    const fileSize = stat.size;

    // Handle Range requests for video/audio streaming
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const stream = fs.createReadStream(file.path, { start, end });

      res.writeHead(HttpStatus.PARTIAL_CONTENT, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': file.mime_type,
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
      });

      stream.pipe(res);
      return;
    }

    // Normal inline response (no range)
    res.writeHead(HttpStatus.OK, {
      'Content-Length': fileSize,
      'Content-Type': file.mime_type,
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
      'Accept-Ranges': 'bytes',
    });

    const stream = fs.createReadStream(file.path);
    stream.pipe(res);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermissions('file.download')
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Request() req: RequestWithUser,
    @Res() res: Response,
  ) {
    const file = await this.filesService.checkDownloadPermission(id, req.user);

    if (!fs.existsSync(file.path)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }

    res.download(file.path, file.name);
  }

  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body() updateFileDto: UpdateFileDto,
    @Request() req: RequestWithUser,
  ) {
    return this.filesService.rename(id, updateFileDto.name, req.user);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req: RequestWithUser) {
    await this.filesService.remove(id, req.user);
    return { message: 'File deleted successfully' };
  }
}


