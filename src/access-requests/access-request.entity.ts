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

  @CreateDateColumn()
  createdAt: Date;

}