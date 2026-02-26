import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';

import { User } from '../entities/user.entity';
import { Folder } from '../entities/folder.entity';

@Entity('access_requests')
export class AccessRequest {

  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { eager: true })
  requester: User;

  @ManyToOne(() => Folder, { eager: true })
  folder: Folder;

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