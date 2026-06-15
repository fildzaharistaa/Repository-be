import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';

@Entity('file_access_logs')
@Unique(['file_id', 'user_id', 'role_id'])
export class FileAccessLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  file_id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  role_id: string;

  @Column({ type: 'timestamp' })
  last_accessed_at: Date;

  @CreateDateColumn()
  created_at: Date;
}
