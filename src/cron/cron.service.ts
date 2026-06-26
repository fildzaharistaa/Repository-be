import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.debug('Running daily file maintenance jobs');
    await this.checkFiveYearOldFiles();
    await this.checkUntouchedFiles();
  }

  async triggerMaintenance() {
    await this.handleCron();
  }

  private async checkFiveYearOldFiles() {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

    const oldFiles = await this.prisma.files.findMany({
      where: {
        created_at: { lt: fiveYearsAgo },
        deleted_at: null,
      },
    });

    for (const file of oldFiles) {
      if (!file.owner_id) continue;

      const existing = await this.prisma.access_requests.findFirst({
        where: {
          fileId: file.id,
          request_type: 'delete_confirmation',
        },
      });

      if (!existing) {
        await this.prisma.access_requests.create({
          data: {
            requesterId: file.owner_id,
            ownerId: file.owner_id,
            fileId: file.id,
            status: 'pending',
            request_type: 'delete_confirmation',
            message: `File "${file.name}" telah berumur 5 tahun. Apakah Anda ingin memindahkannya ke Recycle Bin?`,
          },
        });
        this.logger.log(`Sent delete confirmation for file: ${file.name}`);
      }
    }
  }

  private async checkUntouchedFiles() {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const untouchedFiles = await this.prisma.files.findMany({
      where: {
        last_accessed_at: { lt: oneYearAgo },
        deleted_at: null,
      },
    });

    for (const file of untouchedFiles) {
      if (!file.owner_id) continue;

      const existing = await this.prisma.access_requests.findFirst({
        where: {
          fileId: file.id,
          request_type: 'system_notification',
          status: 'approved',
        },
      });

      if (!existing) {
        await this.prisma.access_requests.create({
          data: {
            requesterId: file.owner_id,
            ownerId: file.owner_id,
            fileId: file.id,
            status: 'approved',
            request_type: 'system_notification',
            response_message: `Sistem: File "${file.name}" jarang dibuka dalam kurun waktu 1 tahun.`,
          },
        });
        this.logger.log(`Sent untouched notification for file: ${file.name}`);
      }
    }
  }
}
