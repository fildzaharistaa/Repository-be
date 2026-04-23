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
  ParseFilePipe,
  MaxFileSizeValidator
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { FilesService } from './files.service';
import { UpdateFileDto } from './update-file.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

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
    }),
  )
  async uploadFile(
    @Param('folderId') folderId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024, message: 'File melebihi batas 5MB' }),
        ],
      }),
    ) file: Express.Multer.File,
    @Request() req: RequestWithUser,
  ) {
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


