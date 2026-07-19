import { FolderPermissionGuard, PermissionType } from './folder-permission.guard';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { FolderPermission } from '../../entities/folder-permission.entity';
import { Folder } from '../../entities/folder.entity';
import { ForbiddenException } from '@nestjs/common';

const makeGuard = (
  folderStub: Partial<Folder> | null,
  permStubs: Partial<FolderPermission>[] = [],
) => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(PermissionType.UPDATE) } as unknown as Reflector;

  const folderRepo = {
    findOne: jest.fn().mockResolvedValue(folderStub),
  } as unknown as Repository<Folder>;

  const permRepo = {
    createQueryBuilder: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(permStubs),
    }),
  } as unknown as Repository<FolderPermission>;

  const guard = new FolderPermissionGuard(reflector, permRepo, folderRepo);
  return { guard, folderRepo };
};

const makeContext = (userId: string, folderId: string) => ({
  getHandler: jest.fn(),
  getClass: jest.fn(),
  switchToHttp: () => ({
    getRequest: () => ({
      user: { id: userId, role_id: 'role-a', active_role_id: null },
      params: { id: folderId },
      body: {},
    }),
  }),
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FolderPermissionGuard — subfolder creator access', () => {
  const OWNER_ID = 'user-owner';
  const SHARED_USER_ID = 'user-shared';
  const SUBFOLDER_ID = 'subfolder-uuid';

  it('allows folder owner to UPDATE regardless of folder_permissions table', async () => {
    const { guard } = makeGuard(
      {
        id: SUBFOLDER_ID,
        owner_id: SHARED_USER_ID,
        owner: { id: SHARED_USER_ID } as any,
        role: null,
        role_id: null,
        parent_id: 'parent-uuid',
      },
      [], // no explicit permission record
    );
    const ctx = makeContext(SHARED_USER_ID, SUBFOLDER_ID) as any;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows original root folder owner to UPDATE (owner_id check)', async () => {
    const { guard } = makeGuard(
      {
        id: SUBFOLDER_ID,
        owner_id: OWNER_ID,
        owner: { id: OWNER_ID } as any,
        role: null,
        role_id: null,
        parent_id: null,
      },
      [],
    );
    const ctx = makeContext(OWNER_ID, SUBFOLDER_ID) as any;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('denies a different user with no explicit permission', async () => {
    const INTRUDER_ID = 'user-intruder';
    const { guard } = makeGuard(
      {
        id: SUBFOLDER_ID,
        owner_id: SHARED_USER_ID,
        owner: { id: SHARED_USER_ID } as any,
        role: null,
        role_id: null,
        parent_id: null,
      },
      [], // no permission record for intruder
    );
    const ctx = makeContext(INTRUDER_ID, SUBFOLDER_ID) as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows shared user with explicit UPDATE permission on the folder', async () => {
    const { guard } = makeGuard(
      {
        id: SUBFOLDER_ID,
        owner_id: OWNER_ID,
        owner: { id: OWNER_ID } as any,
        role: null,
        role_id: null,
        parent_id: null,
      },
      [{ user_id: SHARED_USER_ID, role_id: null, can_update: true, can_delete: false, can_read: true, can_create: false, can_download: false }],
    );
    const ctx = makeContext(SHARED_USER_ID, SUBFOLDER_ID) as any;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('denies shared user when permission record exists but can_update is false', async () => {
    const { guard } = makeGuard(
      {
        id: SUBFOLDER_ID,
        owner_id: OWNER_ID,
        owner: { id: OWNER_ID } as any,
        role: null,
        role_id: null,
        parent_id: null,
      },
      [{ user_id: SHARED_USER_ID, role_id: null, can_update: false, can_delete: false, can_read: true, can_create: false, can_download: false }],
    );
    const ctx = makeContext(SHARED_USER_ID, SUBFOLDER_ID) as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when folder does not exist', async () => {
    const { guard } = makeGuard(null);
    const ctx = makeContext(SHARED_USER_ID, SUBFOLDER_ID) as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
