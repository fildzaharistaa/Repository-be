import { Controller, Get, Param, Query, Headers, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IntegrationService } from './integration.service';
import { Public } from '../common/decorators/public.decorator';

@Public()
@Controller('integration')
export class IntegrationController {
  constructor(private readonly integrationService: IntegrationService) {}

  /**
   * GET /api/integration/files/search?jenis=...&kode=...&nama=...&email=...
   * Cari file milik email tertentu berdasarkan nama/kode indikator.
   */
  @Get('files/search')
  searchFiles(
    @Query('jenis') jenis: string,
    @Query('kode') kode: string,
    @Query('nama') nama: string,
    @Query('email') email: string,
  ) {
    return this.integrationService.searchFiles({ jenis, kode, nama, email });
  }

  /**
   * GET /api/integration/files/unrestricted?jenis=...&kode=...&nama=...
   * Cari semua file tanpa filter owner — butuh x-integration-secret header.
   */
  @Get('files/unrestricted')
  searchFilesUnrestricted(
    @Headers('x-integration-secret') secret: string,
    @Query('jenis') jenis: string,
    @Query('kode') kode: string,
    @Query('nama') nama: string,
  ) {
    this.integrationService.verifySecret(secret);
    return this.integrationService.searchFilesUnrestricted({ jenis, kode, nama });
  }

  /**
   * GET /api/integration/folders?email=...
   * Semua folder milik email tersebut.
   */
  @Get('folders')
  getFolders(@Query('email') email: string) {
    return this.integrationService.getFolders(email);
  }

  /**
   * GET /api/integration/files/in-children?parentFolderId=...&email=...
   * File di sub-folder langsung di bawah parentFolderId.
   */
  @Get('files/in-children')
  getFilesInChildren(
    @Query('parentFolderId') parentFolderId: string,
    @Query('email') email: string,
  ) {
    return this.integrationService.getFilesInChildren(parentFolderId, email);
  }

  /**
   * GET /api/integration/files?folderId=...&email=...
   * File di dalam folder tertentu.
   */
  @Get('files')
  getFiles(
    @Query('folderId') folderId: string,
    @Query('email') email: string,
  ) {
    return this.integrationService.getFilesInFolder(folderId, email);
  }

  /**
   * GET /api/integration/preview/:fileId
   * Preview file (inline).
   */
  @Get('preview/:fileId')
  previewFile(@Param('fileId') fileId: string, @Res() res: Response) {
    return this.integrationService.serveFile(fileId, 'inline', res);
  }

  /**
   * GET /api/integration/download/:fileId
   * Download file (attachment).
   */
  @Get('download/:fileId')
  downloadFile(@Param('fileId') fileId: string, @Res() res: Response) {
    return this.integrationService.serveFile(fileId, 'download', res);
  }
}
