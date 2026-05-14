import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

import { User } from './user.entity';
import { File } from './file.entity';
import { FolderPermission } from './folder-permission.entity';
import { Role } from './role.entity';

@Entity('folders')
export class Folder {

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  parent_id: string | null;

  // 🔥 UNIT FOLDER (wd1 / wd2 / wd3 / general)
  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    default: 'general'
  })
  unit: string;

  // Role workspace ownership — which role this folder belongs to
  @Column({ type: 'uuid', nullable: true })
  role_id: string | null;

  @ManyToOne(() => Role, { nullable: true, eager: false })
  @JoinColumn({ name: 'role_id' })
  role: Role | null;

  // 🔥 OWNER UNTUK FOLDER PRIBADI
  @Column({ type: 'uuid', nullable: true })
  owner_id: string | null;

  @ManyToOne(() => User, (user) => user.ownedFolders, { nullable: true })
  @JoinColumn({ name: 'owner_id' })
  owner: User | null;

  @ManyToOne(() => Folder, (folder) => folder.children, { nullable: true })
  @JoinColumn({ name: 'parent_id' })
  parent: Folder | null;

  @OneToMany(() => Folder, (folder) => folder.parent)
  children: Folder[];

  @OneToMany(() => File, (file) => file.folder)
  files: File[];

  @OneToMany(() => FolderPermission, (permission) => permission.folder)
  permissions: FolderPermission[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn()
  deleted_at: Date | null;
} 