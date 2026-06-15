import { Controller, Get, Query, Param, Res, Headers, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { FilesService } from '../files/files.service';
import { FoldersService } from '../folders/folders.service';
import { UsersService } from '../users/users.service';
import { Public } from '../common/decorators/public.decorator';

const JENIS_LABEL_MAP: Record<string, string> = {
  IKU: 'Indikator Kinerja Utama',
  PK: 'Perjanjian Kinerja',
  'indikator kinerja utama': 'Indikator Kinerja Utama',
  'perjanjian kinerja': 'Perjanjian Kinerja',
  'perjanjian kerja': 'Perjanjian Kerja',
};

function resolveJenisLabel(jenis: string): string {
  if (!jenis) return '';
  const key = jenis.trim().toUpperCase();
  return JENIS_LABEL_MAP[key] || JENIS_LABEL_MAP[jenis.trim().toLowerCase()] || jenis.trim();
}

@Controller('integration')
@Public()
export class IntegrationController {
  constructor(
    private readonly filesService: FilesService,
    private readonly foldersService: FoldersService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /api/integration/files/unrestricted
   * Server-to-server — dikontrol via x-integration-secret header.
   * Mengembalikan semua file dalam folder indikator tanpa filter permission.
   */
  @Get('files/unrestricted')
  async getUnrestrictedFiles(
    @Headers('x-integration-secret') secret: string,
    @Query('jenis') jenis: string,
    @Query('kode') kode: string,
    @Query('nama') nama: string,
  ) {
    const expectedSecret = this.configService.get<string>('INTEGRATION_SECRET');
    if (!expectedSecret || secret !== expectedSecret) {
      throw new ForbiddenException('Invalid integration secret');
    }
    if (!jenis || !kode) return [];
    const jenisLabel = resolveJenisLabel(jenis);
    return this.filesService.findFilesByJenisKodeAndEmail(jenisLabel, kode, nama || kode, undefined);
  }

  /**
   * GET /api/integration/files/search
   * Mode baru: ?jenis=IKU&kode=1.1.1&nama=...&email=xxx
   * Mode lama: ?name=1.1.1&email=xxx
   */
  @Get('files/search')
  async search(
    @Query('jenis') jenis: string,
    @Query('kode') kode: string,
    @Query('nama') nama: string,
    @Query('name') name: string,
    @Query('email') email?: string,
  ) {
    if (jenis && kode) {
      const jenisLabel = resolveJenisLabel(jenis);
      return this.filesService.findFilesByJenisKodeAndEmail(jenisLabel, kode, nama || kode, email);
    }
    if (!name) return [];
    return this.filesService.findFilesByFolderNameAndUserEmail(name, email);
  }

  /**
   * GET /api/integration/folders?email=xxx
   */
  @Get('folders')
  async getFolders(@Query('email') email: string) {
    if (!email) return [];
    const user = await this.usersService.findByEmail(email);
    if (!user) return [];
    return this.foldersService.findAllAccessible(user);
  }

  /**
   * GET /api/integration/files?folderId=xxx&email=xxx
   */
  @Get('files')
  async getFilesByFolder(
    @Query('folderId') folderId: string,
    @Query('email') email: string,
  ) {
    if (!folderId || !email) return [];
    const user = await this.usersService.findByEmail(email);
    if (!user) return [];
    const hasPermission = await this.foldersService.checkPermission(
      user.id, user.role_id, folderId, 'read',
    );
    if (!hasPermission) return [];
    return this.filesService.findAll(folderId, user);
  }

  /**
   * GET /api/integration/files/in-children?parentFolderId=xxx&email=xxx
   */
  @Get('files/in-children')
  async getFilesInChildren(
    @Query('parentFolderId') parentFolderId: string,
    @Query('email') email: string,
  ) {
    if (!parentFolderId || !email) return [];
    return this.filesService.findFilesInChildFolders(parentFolderId, email);
  }

  /**
   * GET /api/integration/debug?jenis=IKU&kode=1.1&email=xxx
   */
  @Get('debug')
  async debug(
    @Query('jenis') jenis: string,
    @Query('kode') kode: string,
    @Query('email') email?: string,
  ) {
    if (!jenis || !kode) {
      return { error: 'Parameter jenis dan kode wajib diisi. Contoh: ?jenis=IKU&kode=1.1&email=xxx@xxx.com' };
    }
    const jenisLabel = resolveJenisLabel(jenis);
    return this.filesService.debugSearchByJenisKode(jenisLabel, kode, email);
  }

  /**
   * GET /api/integration/preview/:fileId
   * Serve file inline tanpa autentikasi (diproxy oleh ikupk-be).
   */
  @Get('preview/:fileId')
  async previewFile(@Param('fileId') fileId: string, @Res() res: Response) {
    const file = await this.filesService.findByIdPublic(fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (!fs.existsSync(file.path)) return res.status(404).json({ error: 'File not on disk' });

    const stat = fs.statSync(file.path);
    res.writeHead(200, {
      'Content-Length': stat.size,
      'Content-Type': file.mime_type || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(file.name)}"`,
    });
    fs.createReadStream(file.path).pipe(res);
  }

  /**
   * GET /api/integration/download/:fileId
   * Force-download file tanpa autentikasi (diproxy oleh ikupk-be).
   */
  @Get('download/:fileId')
  async downloadFile(@Param('fileId') fileId: string, @Res() res: Response) {
    const file = await this.filesService.findByIdPublic(fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (!fs.existsSync(file.path)) return res.status(404).json({ error: 'File not on disk' });
    res.download(file.path, file.name);
  }
}
