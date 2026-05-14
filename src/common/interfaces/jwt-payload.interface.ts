export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: string;
  role_id: string;
  active_role_id?: string;
}
