import {
  PERMISSIONS,
  adminResetPasswordSchema,
  assignBranchesSchema,
  branchAccessGrantSchema,
  createStaffSchema,
  idParams,
  listUsersQuery,
  objectId,
  updateStaffSchema,
} from '@mb/shared';
import { z } from 'zod';
import type { ModuleRouter } from '../../core/http/route';
import {
  addBranchGrant,
  adminResetPassword,
  assignBranches,
  createStaff,
  getStaff,
  listStaff,
  removeBranchGrant,
  setStaffStatus,
  updateStaff,
} from './user.service';

const P = PERMISSIONS;

export function registerUserRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'List staff (branch admins see staff in their own branches)',
    permission: P.USERS_READ,
    query: listUsersQuery,
    handler: ({ query, auth }) => listStaff(auth, query),
  });

  m.route({
    method: 'post',
    path: '/',
    summary: 'Create a staff account with a temporary password',
    description: 'Super admins can create any staff role. Branch admins can create sales staff in their own branches.',
    permission: P.USERS_CREATE,
    body: createStaffSchema,
    handler: ({ body, auth, meta }) => createStaff(auth, body, meta),
  });

  m.route({
    method: 'get',
    path: '/:id',
    summary: 'Get a staff member',
    permission: P.USERS_READ,
    params: idParams,
    handler: ({ params, auth }) => getStaff(auth, params.id),
  });

  m.route({
    method: 'patch',
    path: '/:id',
    summary: 'Update a staff member (name, contact, role, branches)',
    permission: P.USERS_UPDATE,
    params: idParams,
    body: updateStaffSchema,
    handler: ({ params, body, auth, meta }) => updateStaff(auth, params.id, body, meta),
  });

  for (const [action, status, summary] of [
    ['deactivate', 'deactivated', 'Deactivate a staff account and sign it out everywhere'],
    ['suspend', 'suspended', 'Temporarily suspend a staff account'],
    ['activate', 'active', 'Reactivate a staff account'],
  ] as const) {
    m.route({
      method: 'post',
      path: `/:id/${action}`,
      summary,
      permission: P.USERS_DEACTIVATE,
      params: idParams,
      status: 200,
      handler: ({ params, auth, meta }) => setStaffStatus(auth, params.id, status, meta),
    });
  }

  m.route({
    method: 'post',
    path: '/:id/reset-password',
    summary: 'Set a temporary password (the user must change it at next sign-in)',
    permission: P.USERS_RESET_PASSWORD,
    params: idParams,
    body: adminResetPasswordSchema,
    status: 200,
    handler: ({ params, body, auth, meta }) => adminResetPassword(auth, params.id, body.temporaryPassword, meta),
  });

  m.route({
    method: 'put',
    path: '/:id/branches',
    summary: 'Replace the branches a staff member is assigned to',
    permission: P.USERS_ASSIGN_BRANCHES,
    params: idParams,
    body: assignBranchesSchema,
    handler: ({ params, body, auth, meta }) => assignBranches(auth, params.id, body.branches, meta),
  });

  m.route({
    method: 'post',
    path: '/:id/branch-access-grants',
    summary: 'Give a staff member time-limited access to another branch',
    permission: P.USERS_GRANT_ACCESS,
    params: idParams,
    body: branchAccessGrantSchema,
    handler: ({ params, body, auth, meta }) => addBranchGrant(auth, params.id, body, meta),
  });

  m.route({
    method: 'delete',
    path: '/:id/branch-access-grants/:grantId',
    summary: 'Revoke a branch access grant',
    permission: P.USERS_GRANT_ACCESS,
    params: z.object({ id: objectId, grantId: objectId }),
    status: 200,
    handler: ({ params, auth, meta }) => removeBranchGrant(auth, params.id, params.grantId, meta),
  });
}
