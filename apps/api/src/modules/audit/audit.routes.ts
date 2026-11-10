import { PERMISSIONS, listAuditQuery } from '@mb/shared';
import type { ModuleRouter } from '../../core/http/route';
import { listAuditLogs } from './audit.service';

export function registerAuditRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'Audit trail (branch admins see entries for their own branches only)',
    permission: PERMISSIONS.AUDIT_READ,
    query: listAuditQuery,
    handler: ({ query, auth }) => listAuditLogs(auth, query),
  });

  m.route({
    method: 'get',
    path: '/logins',
    summary: 'Sign-in activity: successful and failed sign-ins, lockouts, password changes',
    permission: PERMISSIONS.AUDIT_READ_LOGINS,
    query: listAuditQuery,
    handler: ({ query, auth }) => listAuditLogs(auth, query, true),
  });
}
