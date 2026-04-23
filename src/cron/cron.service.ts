import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { File, User } from '../entities';
import { AccessRequest } from '../access-requests/access-request.entity';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    @InjectRepository(File)
    private fileRepo: Repository<File>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(AccessRequest)
    private accessRequestRepo: Repository<AccessRequest>,
  ) {}

  // Run every day at midnight
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCron() {
    this.logger.debug('Running daily file maintenance jobs');
    await this.checkFiveYearOldFiles();
    await this.checkUntouchedFiles();
  }

  // Helper method to trigger manually (for testing if needed)
  async triggerMaintenance() {
    await this.handleCron();
  }

  private async checkFiveYearOldFiles() {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);

    const oldFiles = await this.fileRepo.find({
      where: {
        created_at: LessThan(fiveYearsAgo),
        deleted_at: IsNull(),
      },
      relations: ['owner'],
    });

    for (const file of oldFiles) {
      if (!file.owner) continue;

      // Check if already notified
      const existing = await this.accessRequestRepo.findOne({
        where: {
          file: { id: file.id },
          request_type: 'delete_confirmation',
        },
      });

      if (!existing) {
        const request = this.accessRequestRepo.create({
          requester: file.owner,
          owner: file.owner,
          file: file,
          status: 'pending',
          request_type: 'delete_confirmation',
          message: `File "${file.name}" telah berumur 5 tahun. Apakah Anda ingin memindahkannya ke Recycle Bin?`,
        });
        await this.accessRequestRepo.save(request);
        this.logger.log(`Sent delete confirmation for file: ${file.name}`);
      }
    }
  }

  private async checkUntouchedFiles() {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const untouchedFiles = await this.fileRepo.find({
      where: {
        last_accessed_at: LessThan(oneYearAgo),
        deleted_at: IsNull(),
      },
      relations: ['owner'],
    });

    for (const file of untouchedFiles) {
      if (!file.owner) continue;

      // Check if a system notification already exists for this file
      const existing = await this.accessRequestRepo.findOne({
        where: {
          file: { id: file.id },
          request_type: 'system_notification',
          status: 'approved',
        },
      });

      if (!existing) {
        const notification = this.accessRequestRepo.create({
          requester: file.owner,
          owner: file.owner,
          file: file,
          status: 'approved', // Shows in 'updates'
          request_type: 'system_notification',
          response_message: `Sistem: File "${file.name}" jarang dibuka dalam kurun waktu 1 tahun.`,
        });
        await this.accessRequestRepo.save(notification);
        this.logger.log(`Sent untouched notification for file: ${file.name}`);
      }
    }
  }
}
