import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { ShareLinksService } from './share-links.service';
import { GenerateShareLinkDto } from './dto/generate-share-link.dto';
import { UpdateShareLinkDto } from './dto/update-share-link.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import type { RequestWithUser } from '../common/interfaces/request-with-user.interface';

@Controller('share')
export class ShareLinksController {
  constructor(private readonly service: ShareLinksService) {}

  private serializeLink(link: any) {
    return {
      id: link.id,
      token: link.token,
      item_type: link.item_type,
      item_id: link.item_id,
      created_by: link.created_by,
      access_level: link.access_level,
      permission: link.permission,
      expires_at: link.expires_at,
      is_active: link.is_active,
      view_count: link.view_count,
      download_count: link.download_count,
      created_at: link.created_at,
      updated_at: link.updated_at,
    };
  }

  // ── Protected: generate a new share link ──────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('generate')
  async generate(@Body() dto: GenerateShareLinkDto, @Req() req: RequestWithUser) {
    const link = await this.service.generate(req.user.id, dto);
    return this.serializeLink(link);
  }

  // ── Protected: get existing active link for item (used to populate modal) ─
  @UseGuards(JwtAuthGuard)
  @Get('item/:type/:id')
  async getExisting(
    @Param('type') type: 'file' | 'folder',
    @Param('id') id: string,
    @Req() req: RequestWithUser,
  ) {
    const link = await this.service.getExistingLink(req.user.id, type, id);
    if (!link) return null;
    return this.serializeLink(link);
  }

  // ── Public: get folder contents (file list) ───────────────────────────────
  @Public()
  @Get(':token/contents')
  async getFolderContents(@Param('token') token: string) {
    return this.service.getFolderContents(token);
  }

  // ── Public: view a file inside a shared folder ────────────────────────────
  @Public()
  @Get(':token/file/:fileId/view')
  async viewFolderFile(
    @Param('token') token: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const { file } = await this.service.getFolderFileForView(token, fileId);
    const stat = fs.statSync(file.path);
    const fileSize = stat.size;
    const range = req.headers['range'];

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
    } else {
      res.writeHead(HttpStatus.OK, {
        'Content-Length': fileSize,
        'Content-Type': file.mime_type,
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(file.path).pipe(res);
    }
  }

  // ── Public: download a file inside a shared folder ────────────────────────
  @Public()
  @Get(':token/file/:fileId/download')
  async downloadFolderFile(
    @Param('token') token: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const { file } = await this.service.getFolderFileForDownload(token, fileId);
    res.download(file.path, file.name);
  }

  // ── Public: view file inline (preview) ────────────────────────────────────
  @Public()
  @Get(':token/view')
  async viewFile(
    @Param('token') token: string,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const { file } = await this.service.getFileForView(token);

    const stat = fs.statSync(file.path);
    const fileSize = stat.size;
    const range = req.headers['range'];

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
    } else {
      res.writeHead(HttpStatus.OK, {
        'Content-Length': fileSize,
        'Content-Type': file.mime_type,
        'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(file.path).pipe(res);
    }
  }

  // ── Public: get share link metadata ───────────────────────────────────────
  @Public()
  @Get(':token')
  async getByToken(@Param('token') token: string) {
    const { link, itemName, itemSize, mimeType, sharedBy, sharedByEmail } =
      await this.service.getByToken(token);
    return {
      token: link.token,
      item_type: link.item_type,
      item_id: link.item_id,
      item_name: itemName,
      item_size: itemSize,
      mime_type: mimeType,
      shared_by: sharedBy,
      shared_by_email: sharedByEmail,
      access_level: link.access_level,
      permission: link.permission,
      expires_at: link.expires_at,
      is_active: link.is_active,
      view_count: link.view_count,
      download_count: link.download_count,
      created_at: link.created_at,
    };
  }

  // ── Public: download file as attachment ───────────────────────────────────
  @Public()
  @Get(':token/download')
  async downloadFile(@Param('token') token: string, @Res() res: Response) {
    const { file } = await this.service.getFileForDownload(token);
    res.download(file.path, file.name);
  }

  // ── Protected: update share link settings ─────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Put(':token')
  async update(
    @Param('token') token: string,
    @Body() dto: UpdateShareLinkDto,
    @Req() req: RequestWithUser,
  ) {
    const isAdmin = !!(req.user as any).role?.is_admin;
    const link = await this.service.update(token, req.user.id, dto, isAdmin);
    return this.serializeLink(link);
  }

  // ── Protected: generate new token for existing link ───────────────────────
  @UseGuards(JwtAuthGuard)
  @Post(':token/regenerate')
  async regenerate(@Param('token') token: string, @Req() req: RequestWithUser) {
    const isAdmin = !!(req.user as any).role?.is_admin;
    const link = await this.service.generateNew(token, req.user.id, isAdmin);
    return this.serializeLink(link);
  }

  // ── Protected: disable share link ─────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Delete(':token')
  async disable(@Param('token') token: string, @Req() req: RequestWithUser) {
    const isAdmin = !!(req.user as any).role?.is_admin;
    return this.service.disable(token, req.user.id, isAdmin);
  }

  // ── Protected: get stats ──────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get(':token/stats')
  async getStats(@Param('token') token: string, @Req() req: RequestWithUser) {
    const isAdmin = !!(req.user as any).role?.is_admin;
    return this.service.getStats(token, req.user.id, isAdmin);
  }

  // ── Protected: get my shared links ────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('my/links')
  async getMyLinks(@Req() req: RequestWithUser) {
    return this.service.getMySharedLinks(req.user.id);
  }
}
