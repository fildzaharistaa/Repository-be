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
  // Use the active role's is_admin flag when available — mirrors the frontend's
  // AuthContext.isAdmin which derives from activeRole, not the primary role.
  const effectiveRole = (user as any).active_role ?? user.role ?? null;
  if (effectiveRole?.is_admin === true) return true;

  const activeRoleId = user.active_role_id ?? user.role_id ?? null;

  const folderOwnerId =
    file.folder?.owner_id ?? (file.folder as any)?.owner?.id ?? null;
  const folderRoleId = file.folder?.role_id ?? null;
  // Folder-owner shortcut only applies when the active role matches the folder's role context.
  // Prevents multi-role users from getting modify rights via a folder they own under a different role.
  const activeRoleMatchesFolderRole =
    !folderRoleId || !activeRoleId || folderRoleId === activeRoleId;
  if (folderOwnerId && folderOwnerId === user.id && activeRoleMatchesFolderRole) return true;

  // Non-private role workspace: any member whose active role matches the folder's
  // owner role has the same modify rights as the folder creator — including over
  // files uploaded by users from other roles who were granted access to the folder.
  // Private roles (Dosen/Tendik) are excluded: their folders are individual workspaces.
  const activeRoleName = (user as any).active_role_name ?? user.role?.name ?? null;
  const activeRoleIsPrivate = isDosenOrTendikName(activeRoleName);
  if (
    !activeRoleIsPrivate &&
    folderRoleId != null &&
    activeRoleId != null &&
    folderRoleId === activeRoleId
  ) return true;

  // Beyond folder-owner/admin, visibility is role-scoped. The viewer's *active*
  // role must match the role the file was uploaded under. Same user with a
  // different active role does NOT bypass this.
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
