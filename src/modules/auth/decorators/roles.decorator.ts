import { SetMetadata } from '@nestjs/common';
import { UserRole } from 'src/database/schema';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

const ROLE_HIERARCHY: Record<UserRole, UserRole[]> = {
  super_admin: ['super_admin', 'admin', 'driver', 'rider'],
  admin: ['admin'],
  driver: ['driver'],
  rider: ['rider'],
};

export function userSatisfiesRole(
  userRoles: UserRole[],
  required: UserRole,
): boolean {
  return userRoles.some(
    (role) => ROLE_HIERARCHY[role]?.includes(required) ?? false,
  );
}
