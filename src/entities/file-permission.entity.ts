import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { File } from './file.entity';
import { User } from './user.entity';
import { Role } from './role.entity';

@Entity('file_permissions')
export class FilePermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  file_id: string;

  @ManyToOne(() => File, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_id' })
  file: File;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  role_id: string | null;

  @ManyToOne(() => Role, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'role_id' })
  role: Role | null;

  @Column({ type: 'boolean', default: false })
  can_read: boolean;

  @Column({ type: 'boolean', default: false })
  can_download: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
