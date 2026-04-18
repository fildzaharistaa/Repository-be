import {Entity,PrimaryGeneratedColumn,Column,ManyToOne,OneToMany,CreateDateColumn,UpdateDateColumn, JoinColumn,} from 'typeorm';
import { Role } from './role.entity';
import { FolderPermission } from './folder-permission.entity';
import { Folder } from './folder.entity';

@Entity('users')
export class User {

  @PrimaryGeneratedColumn('uuid')
  id: string;

@Column({ unique: true, type: 'varchar', length: 255 })
email: string;

  @Column()
  password: string;

  @Column()
  name: string;

  @Column({ type: 'uuid' })
  role_id: string;

  @ManyToOne(() => Role)
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ type: 'varchar', length: 50 })
  unit: string; // wd1 | wd2 | wd3 | sdm

  @OneToMany(() => FolderPermission, (permission) => permission.user)
  folderPermissions: FolderPermission[];

  @OneToMany(() => Folder, (folder) => folder.owner)
  ownedFolders: Folder[];

  @Column({ type: 'int', nullable: true })
  max_folder_depth: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}