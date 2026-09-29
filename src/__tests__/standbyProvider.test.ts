import { describe, expect, it } from 'vitest';
import { DEFAULT_FREE_TARGET_PROVIDERS, DEFAULT_STANDBY_PROVIDER } from '../../shared/constants';
import {
  DEFAULT_MODE_ROLE_ASSIGNMENTS,
  replaceModeRoleProvider,
} from '../ui/modeRoleAssignment';
import {
  activeProvidersForStandby,
  defaultSettings,
  normalizeSettings,
} from '../ui/settingsModel';

describe('optional standby provider', () => {
  // Here the standby only sorts last: it is shown, opened, targetable in free mode and can hold
  // role seats like any other provider. Upstream removes it from the lineup instead.
  it('lists all five providers by default, Meta AI (the default standby) last', () => {
    const settings = defaultSettings();

    expect(settings.standbyProvider).toBe(DEFAULT_STANDBY_PROVIDER);
    expect(activeProvidersForStandby(settings.standbyProvider)).toEqual([...DEFAULT_FREE_TARGET_PROVIDERS, 'meta']);
    expect(settings.presentation.meta).toBe('side');
  });

  it('repairs invalid standby values to Meta AI and keeps the standby in restore-open providers', () => {
    const settings = normalizeSettings({
      standbyProvider: 'not-a-provider',
      openProviders: ['chatgpt', 'meta'],
    });

    expect(settings.standbyProvider).toBe('meta');
    expect(settings.openProviders).toEqual(['chatgpt', 'meta']);
  });

  it('moves a core provider that becomes standby to the end and keeps its seats and pane', () => {
    const settings = normalizeSettings({
      settingsSchemaVersion: 2,
      standbyProvider: 'grok',
      modeRoles: DEFAULT_MODE_ROLE_ASSIGNMENTS,
      openProviders: ['grok', 'meta'],
    });

    expect(activeProvidersForStandby(settings.standbyProvider)).toEqual([
      'chatgpt',
      'claude',
      'gemini',
      'meta',
      'grok',
    ]);
    expect(settings.openProviders).toEqual(['grok', 'meta']);
    expect(settings.presentation.grok).toBe('side');
    expect(settings.presentation.meta).toBe('side');
    expect(settings.modeRoles).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS);
  });

  it('lets the standby hold the center like any other provider', () => {
    const settings = normalizeSettings({
      standbyProvider: 'grok',
      presentation: {
        chatgpt: 'side',
        claude: 'side',
        gemini: 'side',
        grok: 'center',
        meta: 'side',
      },
    });

    expect(settings.presentation.grok).toBe('center');
    expect(settings.presentation.meta).toBe('side');
  });

  it('moves every seat owned by the newly selected standby to the previous standby', () => {
    const swapped = replaceModeRoleProvider(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'grok', 'meta');

    expect(JSON.stringify(swapped)).not.toContain('grok');
    expect(JSON.stringify(swapped)).toContain('meta');
    expect(DEFAULT_MODE_ROLE_ASSIGNMENTS.debate.judge).toBe('grok');
  });
});
