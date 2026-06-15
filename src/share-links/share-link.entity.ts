import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../entities/user.entity';

export type ShareItemType = 'file' | 'folder';
export type ShareAccessLevel = 'anyone' | 'organization';
export type SharePermission = 'view' | 'download';

@Entity('share_links')
export class ShareLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token: string;

  @Column({ type: 'varchar', length: 10 })
  item_type: ShareItemType;

  @Column({ type: 'uuid' })
  item_id: string;

  @Column({ type: 'uuid' })
  created_by: string;

  @ManyToOne(() => User, { nullable: true, eager: false })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @Column({ type: 'varchar', length: 20, default: 'anyone' })
  access_level: ShareAccessLevel;

  @Column({ type: 'varchar', length: 20, default: 'view' })
  permission: SharePermission;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'int', default: 0 })
  view_count: number;

  @Column({ type: 'int', default: 0 })
  download_count: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
