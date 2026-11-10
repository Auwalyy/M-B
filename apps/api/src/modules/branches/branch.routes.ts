import { PERMISSIONS, branchIdOrCodeParams, createBranchSchema, idParams, listBranchesQuery, updateBranchSchema } from '@mb/shared';
import type { ModuleRouter } from '../../core/http/route';
import { createBranch, getBranch, listBranches, setBranchStatus, updateBranch } from './branch.service';

export function registerBranchRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'List branches',
    description: 'Visitors get active branches with public fields. Staff get the branches in their scope with full details.',
    auth: 'optional',
    query: listBranchesQuery,
    handler: ({ query, maybeAuth }) => listBranches(query, maybeAuth),
  });

  m.route({
    method: 'get',
    path: '/:idOrCode',
    summary: 'Get a branch by id or code (e.g. KAN01)',
    auth: 'optional',
    params: branchIdOrCodeParams,
    handler: ({ params, maybeAuth }) => getBranch(params.idOrCode, maybeAuth),
  });

  m.route({
    method: 'post',
    path: '/',
    summary: 'Create a branch',
    permission: PERMISSIONS.BRANCHES_CREATE,
    body: createBranchSchema,
    handler: ({ body, auth, meta }) => createBranch(body, auth, meta),
  });

  m.route({
    method: 'patch',
    path: '/:id',
    summary: 'Update a branch',
    description: 'Super admins can edit any field. Branch admins can edit contact details, opening hours and services for their own branch.',
    params: idParams,
    body: updateBranchSchema,
    handler: ({ params, body, auth, meta }) => updateBranch(params.id, body, auth, meta),
  });

  m.route({
    method: 'post',
    path: '/:id/deactivate',
    summary: 'Deactivate a branch (hidden from the storefront; records are kept)',
    permission: PERMISSIONS.BRANCHES_DEACTIVATE,
    params: idParams,
    status: 200,
    handler: ({ params, auth, meta }) => setBranchStatus(params.id, 'inactive', auth, meta),
  });

  m.route({
    method: 'post',
    path: '/:id/activate',
    summary: 'Reactivate a branch',
    permission: PERMISSIONS.BRANCHES_DEACTIVATE,
    params: idParams,
    status: 200,
    handler: ({ params, auth, meta }) => setBranchStatus(params.id, 'active', auth, meta),
  });
}
