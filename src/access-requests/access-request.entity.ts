import {Entity,PrimaryGeneratedColumn,Column,ManyToOne,CreateDateColumn,} from 'typeorm';
import { User } from '../entities/user.entity';
import { Folder } from '../entities/folder.entity';
import { File } from '../entities/file.entity';

@Entity('access_requests')
export class AccessRequest {

  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { eager: true })
  requester: User;

  @ManyToOne(() => Folder, { eager: true, nullable: true })
  folder: Folder;

  @ManyToOne(() => File, { eager: true, nullable: true })
  file: File;

  @ManyToOne(() => User, { eager: true })
  owner: User;

  @Column({
    type: 'varchar',
    default: 'pending',
  })
  status: 'pending' | 'approved' | 'rejected';

  @Column({ type: 'varchar', length: 20, default: 'access' })
  request_type: 'access' | 'hierarchy';

  @Column({ type: 'int', nullable: true })
  requested_depth: number | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  message?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  response_message?: string | null;

  @Column({ type: 'boolean', default: true })
  can_read: boolean;

  @Column({ type: 'boolean', default: false })
  can_download: boolean;

  @Column({ type: 'boolean', default: false })
  can_create: boolean;

  @Column({ type: 'boolean', default: false })
  can_update: boolean;

  @Column({ type: 'boolean', default: false })
  can_delete: boolean;

  @CreateDateColumn()
  createdAt: Date;

}