import { Devvit } from '@devvit/public-api';
import type { SettingsFormField } from '@devvit/public-api';
import type { GavelConfig, DisciplineThreshold } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// ─── Settings Field Definitions ───────────────────────────────────────────────

export const settingsFields: SettingsFormField[] = [
  {
    type: 'boolean',
    name: 'enabled',
    label: 'Enable Gavel',
    defaultValue: true,
  },
  {
    type: 'boolean',
    name: 'observationMode',
    label: 'Observation Mode (log only, no actions)',
    defaultValue: false,
    helpText: 'When ON, Gavel records what it would have done but takes no action. Use this to verify thresholds before enabling live enforcement.',
  },
  {
    type: 'boolean',
    name: 'trackRemovals',
    label: 'Auto-track removals as strikes',
    defaultValue: true,
    helpText: 'Automatically log a strike when a moderator removes a post or comment.',
  },
  {
    type: 'number',
    name: 'strike1Count',
    label: 'Warning threshold (strikes)',
    defaultValue: 1,
    helpText: 'Number of active strikes before a warning is sent.',
  },
  {
    type: 'number',
    name: 'strike2Count',
    label: 'Temp ban threshold (strikes)',
    defaultValue: 2,
    helpText: 'Number of active strikes before a temporary ban is issued.',
  },
  {
    type: 'number',
    name: 'tempBanDays',
    label: 'Temp ban duration (days)',
    defaultValue: 3,
    helpText: 'How many days the temporary ban lasts.',
  },
  {
    type: 'number',
    name: 'strike3Count',
    label: 'Perm ban threshold (strikes)',
    defaultValue: 3,
    helpText: 'Number of active strikes before a permanent ban is issued.',
  },
  {
    type: 'boolean',
    name: 'appealAllowed',
    label: 'Allow ban appeals',
    defaultValue: true,
    helpText: 'Users can submit structured appeals through Gavel.',
  },
  {
    type: 'number',
    name: 'appealLockDays',
    label: 'Re-appeal lockout after uphold (days)',
    defaultValue: 30,
    helpText: 'How many days a user must wait before appealing again after an upheld decision.',
  },
  {
    type: 'number',
    name: 'strikeExpiryDays',
    label: 'Strike expiry in days (0 = never)',
    defaultValue: 0,
    helpText: 'Strikes older than this many days are excluded from the active count. Set 0 to never expire.',
  },
];

// ─── Config Reading ───────────────────────────────────────────────────────────

type SettingValue = string | number | boolean | string[];

export function settingsToConfig(settings: Record<string, SettingValue>): GavelConfig {
  const s1 = Math.max(1, Number(settings['strike1Count'] ?? 1));
  const s2 = Math.max(2, Number(settings['strike2Count'] ?? 2));
  const s3 = Math.max(3, Number(settings['strike3Count'] ?? 3));
  const tempDays = Math.max(1, Number(settings['tempBanDays'] ?? 3));
  const appealLockDays = Math.max(1, Number(settings['appealLockDays'] ?? 30));
  const strikeExpiryDays = Math.max(0, Number(settings['strikeExpiryDays'] ?? 0));

  const thresholds: DisciplineThreshold[] = [
    { strikeCount: s1, action: 'warning' },
    { strikeCount: s2, action: 'temp_ban', banDurationDays: tempDays },
    { strikeCount: s3, action: 'permanent_ban' },
  ];

  return {
    enabled: Boolean(settings['enabled'] ?? true),
    observationMode: Boolean(settings['observationMode'] ?? false),
    trackRemovals: Boolean(settings['trackRemovals'] ?? true),
    thresholds,
    warningMessageTemplate: DEFAULT_CONFIG.warningMessageTemplate,
    tempBanMessageTemplate: DEFAULT_CONFIG.tempBanMessageTemplate,
    permBanMessageTemplate: DEFAULT_CONFIG.permBanMessageTemplate,
    appealAllowed: Boolean(settings['appealAllowed'] ?? true),
    appealLockDays,
    strikeExpiryDays,
  };
}

export async function getConfig(
  context: { settings: { getAll: () => Promise<Record<string, SettingValue>> } }
): Promise<GavelConfig> {
  try {
    const settings = await context.settings.getAll();
    return settingsToConfig(settings);
  } catch (err) {
    console.error('[Gavel][config] Failed to read settings, using defaults:', err);
    return { ...DEFAULT_CONFIG };
  }
}
