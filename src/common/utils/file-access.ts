import { Repository } from 'typeorm';
import { File, Folder, Role, User } from '../../entities';

export function isDosenOrTendikName(name?: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  return n.includes('dosen') || n.includes('tendik');
}

type FileLike = File & {
  folder?: Folder | null;
  uploaded_by_role?: Role | null;
};

type UserLike = User & {
  active_role_id?: string | null;
  active_role_name?: string | null;
  role?: Role | null;
};

export async function canShareOrModifyFile(
  file: FileLike,
  user: UserLike,
  deps?: { roleRepo?: Repository<Role> },
): Promise<boolean> {
  if (!user?.id) return false;
  if (user.role?.is_admin) return true;

  const folderOwnerId =
    file.folder?.owner_id ?? (file.folder as any)?.owner?.id ?? null;
  if (folderOwnerId && folderOwnerId === user.id) return true;

  // Beyond folder-owner/admin, visibility is role-scoped. The viewer's *active*
  // role must match the role the file was uploaded under. Same user with a
  // different active role does NOT bypass this.
  const activeRoleId = user.active_role_id ?? user.role_id ?? null;
  if (!activeRoleId || !file.uploaded_by_role_id) return false;
  if (file.uploaded_by_role_id !== activeRoleId) return false;

  // Role matches. For Dosen/Tendik uploads, additionally require the viewer to
  // be the actual uploader user (user-scoped exception).
  let uploaderRoleName: string | null | undefined = file.uploaded_by_role?.name;
  if (!uploaderRoleName && file.uploaded_by_role_id && deps?.roleRepo) {
    const r = await deps.roleRepo.findOne({
      where: { id: file.uploaded_by_role_id },
    });
    uploaderRoleName = r?.name ?? null;
  }
  if (isDosenOrTendikName(uploaderRoleName)) {
    return !!file.owner_id && file.owner_id === user.id;
  }
  return true;
}
