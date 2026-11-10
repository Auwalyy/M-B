import { z } from 'zod';
import { objectId, paginationQuery } from './common';

export const listAuditQuery = paginationQuery.extend({
  action: z.string().trim().max(80).optional(),
  actor: objectId.optional(),
  branch: objectId.optional(),
  entityKind: z.string().trim().max(40).optional(),
  entityId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
