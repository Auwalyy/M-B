import type { BranchStatus, RoleKey, UserStatus } from '@mb/shared';
import { Badge, type Tone } from '@/components/ui/display';

const ROLE_TONES: Record<RoleKey, Tone> = { SUPER_ADMIN: 'accent', BRANCH_ADMIN: 'brand', SALES_STAFF: 'info', CUSTOMER: 'neutral' };

export function RoleBadge({ role, label }: { role: RoleKey; label: string }) {
  return <Badge tone={ROLE_TONES[role]}>{label}</Badge>;
}

const USER_STATUS: Record<UserStatus, { tone: Tone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  suspended: { tone: 'warning', label: 'Suspended' },
  deactivated: { tone: 'neutral', label: 'Deactivated' },
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const s = USER_STATUS[status];
  return <Badge tone={s.tone} dot>{s.label}</Badge>;
}

export function BranchStatusBadge({ status }: { status: BranchStatus }) {
  return status === 'active' ? <Badge tone="success" dot>Active</Badge> : <Badge tone="neutral" dot>Inactive</Badge>;
}

const ACTIONS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Failed sign-in',
  'auth.login_blocked': 'Blocked sign-in (inactive account)',
  'auth.account_locked': 'Account locked after failed attempts',
  'auth.logout': 'Signed out',
  'auth.register': 'Created customer account',
  'auth.password_changed': 'Changed password',
  'auth.password_reset_requested': 'Requested password reset',
  'auth.password_reset': 'Reset password by email link',
  'auth.refresh_reuse_detected': 'Possible stolen session blocked',
  'auth.session_revoked': 'Signed out a device',
  'auth.sessions_revoked': 'Signed out all other devices',
  'branch.created': 'Created branch',
  'branch.updated': 'Updated branch',
  'branch.activated': 'Reactivated branch',
  'branch.deactivated': 'Deactivated branch',
  'user.created': 'Created staff account',
  'user.updated': 'Updated staff details',
  'user.role_changed': 'Changed staff role',
  'user.activated': 'Reactivated staff account',
  'user.suspended': 'Suspended staff account',
  'user.deactivated': 'Deactivated staff account',
  'user.password_reset_by_admin': 'Reset staff password',
  'user.branch_access_granted': 'Granted cross-branch access',
  'user.branch_access_revoked': 'Revoked cross-branch access',
  'user.profile_updated': 'Updated own profile',
  'user.super_admin_bootstrapped': 'Super Admin account created',
  'role.updated': 'Edited role permissions',
  'role.reset': 'Restored default role permissions',
  'settings.updated': 'Updated company settings',
};

export function actionLabel(action: string): string {
  return ACTIONS[action] ?? action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function actionTone(action: string): Tone {
  if (/failed|locked|blocked|reuse|deactivated|suspended|revoked/.test(action)) return 'danger';
  if (action.startsWith('auth.')) return 'neutral';
  if (/created|granted|activated/.test(action)) return 'success';
  return 'info';
}

export const SOURCE_LABEL: Record<string, string> = { online: 'Online', walk_in: 'Walk-in', whatsapp: 'WhatsApp', phone: 'Phone', guest_checkout: 'Guest checkout' };
