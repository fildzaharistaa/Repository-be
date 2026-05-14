import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Role } from './role.entity';

export enum UserRoleStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING_REACTIVATION = 'PENDING_REACTIVATION',
}

@Entity('user_roles')
@Index(['user_id', 'status'])
@Index(['role_id'])
export class UserRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  role_id: string;

  @ManyToOne(() => User, (user) => user.userRoles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Role, (role) => role.userRoles, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ type: 'boolean', default: false })
  is_primary: boolean;

  @Column({ type: 'varchar', length: 25, default: UserRoleStatus.ACTIVE })
  status: UserRoleStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  suspended_reason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  assigned_at: Date;

  @Column({ type: 'uuid', nullable: true })
  assigned_by: string | null;

  @Column({ type: 'timestamp', nullable: true })
  suspended_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  reactivated_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn()
  deleted_at: Date | null;
}
