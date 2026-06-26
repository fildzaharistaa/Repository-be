export function isDosenOrTendikName(name?: string | null): boolean {
  const n = (name ?? '').toLowerCase();
  return n.includes('dosen') || n.includes('tendik');
}

type FileLike = {
  id: string;
  owner_id?: string | null;
  folder_id?: string | null;
  uploaded_by_role_id?: string | null;
  folder?: { owner_id?: string | null; role_id?: string | null } | null;
  uploaded_by_role?: { name?: string | null } | null;
};

type UserLike = {
  id: string;
  role_id?: string | null;
  active_role_id?: string | null;
  active_role_name?: string | null;
  role?: { name?: string | null; is_admin?: boolean | null } | null;
  active_role?: { name?: string | null; is_admin?: boolean | null } | null;
};

export async function canShareOrModifyFile(
  file: FileLike,
  user: UserLike,
  deps?: { findRole?: (id: string) => Promise<{ name?: string | null } | null> },
): Promise<boolean> {
  if (!user?.id) return false;

  const effectiveRole = (user as any).active_role ?? user.role ?? null;
  if (effectiveRole?.is_admin === true) return true;

  const activeRoleId = user.active_role_id ?? user.role_id ?? null;

  const folderOwnerId =
    file.folder?.owner_id ?? (file.folder as any)?.owner?.id ?? null;
  const folderRoleId = file.folder?.role_id ?? null;
  const activeRoleMatchesFolderRole =
    !folderRoleId || !activeRoleId || folderRoleId === activeRoleId;
  if (folderOwnerId && folderOwnerId === user.id && activeRoleMatchesFolderRole) return true;

  const activeRoleName = (user as any).active_role_name ?? user.role?.name ?? null;
  const activeRoleIsPrivate = isDosenOrTendikName(activeRoleName);
  if (
    !activeRoleIsPrivate &&
    folderRoleId != null &&
    activeRoleId != null &&
    folderRoleId === activeRoleId
  ) return true;

  if (!activeRoleId || !file.uploaded_by_role_id) return false;
  if (file.uploaded_by_role_id !== activeRoleId) return false;

  let uploaderRoleName: string | null | undefined = file.uploaded_by_role?.name;
  if (!uploaderRoleName && file.uploaded_by_role_id && deps?.findRole) {
    const r = await deps.findRole(file.uploaded_by_role_id);
    uploaderRoleName = r?.name ?? null;
  }
  if (isDosenOrTendikName(uploaderRoleName)) {
    return !!file.owner_id && file.owner_id === user.id;
  }
  return true;
}
