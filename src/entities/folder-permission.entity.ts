import {Entity,PrimaryGeneratedColumn,Column,ManyToOne,JoinColumn,CreateDateColumn,UpdateDateColumn,
} from 'typeorm';
import { Folder } from './folder.entity';
import { User } from './user.entity';
import { Role } from './role.entity';

@Entity('folder_permissions')
export class FolderPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  folder_id: string;

  @ManyToOne(() => Folder, (folder) => folder.permissions)
  @JoinColumn({ name: 'folder_id' })
  folder: Folder;

  @Column({ type: 'uuid', nullable: true })
  user_id: string | null;

  @ManyToOne(() => User, (user) => user.folderPermissions, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'uuid', nullable: true })
  role_id: string | null;

  @ManyToOne(() => Role, (role) => role.folderPermissions, { nullable: true })
  @JoinColumn({ name: 'role_id' })
  role: Role | null;

  @Column({ type: 'boolean', default: false })
  can_create: boolean;

  @Column({ type: 'boolean', default: false })
  can_read: boolean;

  @Column({ type: 'boolean', default: false })
  can_update: boolean;

  @Column({ type: 'boolean', default: false })
  can_delete: boolean;

  @Column({ type: 'boolean', default: false })
  can_download: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

