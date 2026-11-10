import {
  PERMISSIONS,
  TRANSFER_ACTIONS,
  adjustmentSchema,
  idParams,
  listAdjustmentsQuery,
  listInventoryQuery,
  listMovementsQuery,
  listTransfersQuery,
  objectId,
  reviewSchema,
  stockInSchema,
  stockOutSchema,
  transferSchema,
  updateInventorySchema,
} from '@mb/shared';
import { z } from 'zod';
import type { ModuleRouter } from '../../core/http/route';
import {
  actOnTransfer,
  createAdjustment,
  createTransfer,
  getTransfer,
  listAdjustments,
  listInventory,
  listMovements,
  listTransfers,
  reviewAdjustment,
  stockIn,
  stockOut,
  updateInventory,
} from './inventory.service';

const P = PERMISSIONS;

export function registerInventoryRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'Stock levels per product and branch (scoped to your branches)',
    permission: P.INVENTORY_READ,
    query: listInventoryQuery,
    handler: ({ query, auth }) => listInventory(auth, query),
  });
  m.route({
    method: 'get',
    path: '/low-stock',
    summary: 'Items at or below their reorder level',
    permission: P.INVENTORY_READ,
    query: listInventoryQuery,
    handler: ({ query, auth }) => listInventory(auth, { ...query, lowStock: true }),
  });
  m.route({
    method: 'patch',
    path: '/:id',
    summary: 'Set the reorder level or hide an item at a branch',
    permission: P.INVENTORY_UPDATE,
    params: idParams,
    body: updateInventorySchema,
    handler: ({ params, body, auth, meta }) => updateInventory(auth, params.id, body, meta),
  });
  m.route({
    method: 'get',
    path: '/movements',
    summary: 'Stock movement ledger (every change, who made it and why)',
    permission: P.INVENTORY_READ,
    query: listMovementsQuery,
    handler: ({ query, auth }) => listMovements(auth, query),
  });
  m.route({
    method: 'post',
    path: '/stock-in',
    summary: 'Receive stock at a branch (e.g. a supplier delivery)',
    permission: P.INVENTORY_STOCK_IN,
    body: stockInSchema,
    handler: ({ body, auth, meta }) => stockIn(auth, body, meta),
  });
  m.route({
    method: 'post',
    path: '/stock-out',
    summary: 'Remove stock that is damaged, lost, expired or returned',
    description: 'Cannot remove reserved units unless the caller holds inventory:override.',
    permission: P.INVENTORY_STOCK_OUT,
    body: stockOutSchema,
    handler: ({ body, auth, meta }) => stockOut(auth, body, meta),
  });

  m.route({
    method: 'get',
    path: '/adjustments',
    summary: 'Stock count adjustments',
    permission: P.INVENTORY_READ,
    query: listAdjustmentsQuery,
    handler: ({ query, auth }) => listAdjustments(auth, query),
  });
  m.route({
    method: 'post',
    path: '/adjustments',
    summary: 'Correct stock after a count',
    description: 'Applied immediately when within the approval threshold and the requester may approve; otherwise waits for a second person.',
    permission: P.INVENTORY_ADJUST,
    body: adjustmentSchema,
    handler: ({ body, auth, meta }) => createAdjustment(auth, body, meta),
  });
  for (const decision of ['approve', 'reject'] as const) {
    m.route({
      method: 'post',
      path: `/adjustments/:id/${decision}`,
      summary: decision === 'approve' ? 'Approve and apply an adjustment' : 'Reject an adjustment',
      permission: P.INVENTORY_APPROVE_ADJUSTMENT,
      params: idParams,
      body: reviewSchema,
      status: 200,
      handler: ({ params, body, auth, meta }) => reviewAdjustment(auth, params.id, decision, body.note, meta),
    });
  }

  m.route({
    method: 'get',
    path: '/transfers',
    summary: 'Transfers into or out of your branches',
    permission: P.INVENTORY_READ,
    query: listTransfersQuery,
    handler: ({ query, auth }) => listTransfers(auth, query),
  });
  m.route({
    method: 'post',
    path: '/transfers',
    summary: 'Request a stock transfer between branches',
    permission: P.INVENTORY_READ,
    body: transferSchema,
    handler: ({ body, auth, meta }) => createTransfer(auth, body, meta),
  });
  m.route({ method: 'get', path: '/transfers/:id', summary: 'Get a transfer', permission: P.INVENTORY_READ, params: idParams, handler: ({ params, auth }) => getTransfer(auth, params.id) });
  m.route({
    method: 'post',
    path: '/transfers/:id/:action',
    summary: 'Move a transfer forward: approve, reject, dispatch (deducts at source), receive (adds at destination) or cancel',
    permission: P.INVENTORY_READ,
    params: z.object({ id: objectId, action: z.enum(TRANSFER_ACTIONS) }),
    body: reviewSchema,
    status: 200,
    handler: ({ params, body, auth, meta }) => actOnTransfer(auth, params.id, params.action, body.note, meta),
  });
}
