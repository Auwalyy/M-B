import { PERMISSIONS, updateSettingsSchema } from '@mb/shared';
import type { ModuleRouter } from '../../core/http/route';
import { getSettingsDoc, toPublicSettings, toSettingsDto, updateSettings } from './settings.service';

export function registerSettingsRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'Company settings (public subset for visitors, full settings for authorised staff)',
    auth: 'optional',
    handler: async ({ maybeAuth }) => {
      const doc = await getSettingsDoc();
      return maybeAuth?.can(PERMISSIONS.SETTINGS_READ) ? toSettingsDto(doc) : toPublicSettings(doc);
    },
  });

  m.route({
    method: 'patch',
    path: '/',
    summary: 'Update company settings',
    permission: PERMISSIONS.SETTINGS_UPDATE,
    body: updateSettingsSchema,
    handler: ({ body, auth, meta }) => updateSettings(body, auth, meta),
  });
}
