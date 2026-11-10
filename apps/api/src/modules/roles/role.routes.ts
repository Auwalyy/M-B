import { PERMISSIONS, idParams, updateRoleSchema } from '@mb/shared';
import type { ModuleRouter } from '../../core/http/route';
import { listRoles, resetRole, updateRole } from './role.service';

export function registerRoleRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'List roles with their permissions and user counts',
    permission: PERMISSIONS.ROLES_READ,
    handler: () => listRoles(),
  });

  m.route({
    method: 'patch',
    path: '/:id',
    summary: "Edit a role's name, description or permissions",
    permission: PERMISSIONS.ROLES_UPDATE,
    params: idParams,
    body: updateRoleSchema,
    handler: ({ params, body, auth, meta }) => updateRole(params.id, body, auth, meta),
  });

  m.route({
    method: 'post',
    path: '/:id/reset',
    summary: "Restore a role's default permissions",
    permission: PERMISSIONS.ROLES_UPDATE,
    params: idParams,
    status: 200,
    handler: ({ params, auth, meta }) => resetRole(params.id, auth, meta),
  });
}
