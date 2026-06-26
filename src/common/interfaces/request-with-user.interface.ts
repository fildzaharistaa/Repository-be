import { Request } from 'express';

export interface RequestWithUser extends Request {
  user: {
    id: string;
    email?: string;
    role_id: string;
    role?: { name: string; is_private?: boolean; is_admin?: boolean };
    active_role_id?: string;
    active_role_name?: string;
  };
}
