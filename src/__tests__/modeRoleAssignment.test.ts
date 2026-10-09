import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE_ROLE_ASSIGNMENTS,
  assignModeRole,
  keepModeRolesWithinProviders,
  migrateLegacyModeRoleAssignments,
  isDefaultModeRoles,
  normalizeModeRoleAssignments,
  restoreModeRoles,
  toggleOptionalSeat,
  type ModeRoleAssignments,
} from '../ui/modeRoleAssignment';
import type { AIProvider, ProviderState } from '../../shared/types';
import { defaultRolesForPreset, seatedProvidersForPreset } from '../ui/presetCatalogData';
import { mergeSettings, normalizeSettings, SETTINGS_SCHEMA_VERSION } from '../ui/settingsModel';

const LEGACY_MODE_ROLES: ModeRoleAssignments = {
  debate: { pro: 'chatgpt', con: 'claude', judge: 'gemini', summary: 'gemini' },
  consult: { first: 'chatgpt', second: 'gemini', third: 'none', reviewer: 'claude', summary: 'gemini' },
  coding: { planner: 'gemini', reviewer: 'chatgpt', coder: 'claude', tester: 'chatgpt' },
  roundtable: { first: 'claude', second: 'gemini', third: 'chatgpt', fourth: 'claude' },
};

describe('normalizeModeRoleAssignments', () => {
  it('uses every provider exactly once in each built-in setup, with Meta as the extra consult answerer', () => {
    const four = ['chatgpt', 'claude', 'gemini', 'grok'];
    const { consult, ...others } = DEFAULT_MODE_ROLE_ASSIGNMENTS;
    for (const roles of Object.values(others)) {
      expect([...Object.values(roles)].sort()).toEqual(four);
    }
    expect([...Object.values(consult)].sort()).toEqual([...four, 'meta']);
  });

  it('lets only the optional consult seat be set to none', () => {
    const normalized = normalizeModeRoleAssignments({
      consult: { third: 'none', first: 'none' },
      debate: { pro: 'none' },
    });
    expect(normalized.consult.third).toBe('none');
    expect(normalized.consult.first).toBe(DEFAULT_MODE_ROLE_ASSIGNMENTS.consult.first);
    expect(normalized.debate.pro).toBe(DEFAULT_MODE_ROLE_ASSIGNMENTS.debate.pro);
  });

  it('keeps an unused consult seat unused when repairing roles to a provider list', () => {
    const roles = { ...DEFAULT_MODE_ROLE_ASSIGNMENTS, consult: { ...DEFAULT_MODE_ROLE_ASSIGNMENTS.consult, third: 'none' as const } };
    const repaired = keepModeRolesWithinProviders(roles, ['chatgpt', 'claude', 'gemini', 'grok']);
    expect(repaired.consult.third).toBe('none');
  });

  it('fills defaults for missing/garbage input', () => {
    expect(normalizeModeRoleAssignments(undefined)).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS);
    expect(normalizeModeRoleAssignments({ debate: { pro: 'bogus' } }).debate.pro).toBe(
      DEFAULT_MODE_ROLE_ASSIGNMENTS.debate.pro,
    );
  });

  it('migrates exact legacy three-provider defaults without replacing custom modes', () => {
    const migrated = migrateLegacyModeRoleAssignments({
      ...LEGACY_MODE_ROLES,
      consult: { first: 'grok', second: 'gemini', reviewer: 'claude', summary: 'chatgpt' },
    });

    expect(migrated.debate).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS.debate);
    expect(migrated.coding).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS.coding);
    expect(migrated.roundtable).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS.roundtable);
    // A saved consult setup from before the third seat gets the default third answerer.
    expect(migrated.consult).toEqual({ first: 'grok', second: 'gemini', third: 'meta', reviewer: 'claude', summary: 'chatgpt' });
  });

  it('runs the legacy migration only for unversioned saved settings', () => {
    expect(normalizeModeRoleAssignments(LEGACY_MODE_ROLES)).toEqual(LEGACY_MODE_ROLES);

    const upgraded = normalizeSettings({ modeRoles: LEGACY_MODE_ROLES });
    expect(upgraded.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(upgraded.modeRoles).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS);

    const savedCustom = mergeSettings(upgraded, { modeRoles: LEGACY_MODE_ROLES });
    expect(savedCustom.modeRoles).toEqual(LEGACY_MODE_ROLES);
    expect(normalizeSettings(savedCustom).modeRoles).toEqual(LEGACY_MODE_ROLES);
  });

  it('keeps valid overrides and allows the same provider in multiple roles', () => {
    const normalized = normalizeModeRoleAssignments({
      debate: { pro: 'gemini', con: 'claude', judge: 'gemini', summary: 'claude' },
    });
    expect(normalized.debate).toEqual({ pro: 'gemini', con: 'claude', judge: 'gemini', summary: 'claude' });
  });
});

describe('toggleOptionalSeat', () => {
  // The strip under the input is how a user drops Meta from consult; only the optional seat moves.
  it('unticking the third answerer leaves consult with four AIs', () => {
    expect(toggleOptionalSeat(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'consult', 'meta')?.consult.third).toBe('none');
  });

  it('ticking an unseated AI fills the unused third seat', () => {
    const fourOnly = assignModeRole(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'consult', 'third', 'none');
    expect(toggleOptionalSeat(fourOnly, 'consult', 'meta')?.consult.third).toBe('meta');
  });

  it('unticking any answerer moves the later answerers up, so consult still has two', () => {
    const consult = toggleOptionalSeat(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'consult', 'grok')?.consult;
    expect(consult).toMatchObject({ first: 'chatgpt', second: 'meta', third: 'none' });
  });

  it('keeps the last two answerers, because consult needs two to compare', () => {
    const fourOnly = assignModeRole(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'consult', 'third', 'none');
    expect(toggleOptionalSeat(fourOnly, 'consult', 'chatgpt')).toBeUndefined();
    expect(toggleOptionalSeat(fourOnly, 'consult', 'grok')).toBeUndefined();
  });

  // The review is the step that checks the answers, so it always runs; the summary is optional.
  it('keeps the reviewer and modes without an optional seat frozen', () => {
    expect(toggleOptionalSeat(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'consult', 'claude')).toBeUndefined();
    expect(toggleOptionalSeat(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'debate', 'meta')).toBeUndefined();
  });

  it('unticking the summary AI leaves the summary unused, and ticking it puts it back there', () => {
    const noSummary = toggleOptionalSeat(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'consult', 'gemini')!;
    expect(noSummary.consult).toMatchObject({ summary: 'none', third: 'meta' });
    expect(toggleOptionalSeat(noSummary, 'consult', 'gemini')?.consult).toMatchObject({ summary: 'gemini', third: 'meta' });
  });

  it('puts a returning AI in a free answer seat when its default seat is taken', () => {
    const noMeta = toggleOptionalSeat(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'consult', 'meta')!;
    const noGemini = toggleOptionalSeat(noMeta, 'consult', 'gemini')!;
    expect(toggleOptionalSeat(noGemini, 'consult', 'meta')?.consult).toMatchObject({ third: 'meta', summary: 'none' });
  });
});

describe('restoreModeRoles', () => {
  // The strip's Defaults button undoes a run of chip toggles in the mode on screen only.
  it('resets the chosen mode and leaves the other modes as the user set them', () => {
    const toggled = toggleOptionalSeat(toggleOptionalSeat(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'consult', 'grok')!, 'consult', 'gemini')!;
    const customDebate = assignModeRole(toggled, 'debate', 'pro', 'meta');
    expect(isDefaultModeRoles(customDebate, 'consult')).toBe(false);

    const restored = restoreModeRoles(customDebate, 'consult');
    expect(restored.consult).toEqual(DEFAULT_MODE_ROLE_ASSIGNMENTS.consult);
    expect(isDefaultModeRoles(restored, 'consult')).toBe(true);
    expect(restored.debate.pro).toBe('meta');
  });
});

describe('seatedProvidersForPreset', () => {
  const states = (down: AIProvider[]) =>
    Object.fromEntries(
      (['chatgpt', 'claude', 'gemini', 'grok', 'meta'] as const).map((provider) => {
        const up = !down.includes(provider);
        return [provider, { provider, webview: up ? 'loaded' : 'none', dom: up ? 'ready' : 'unknown', login: up ? 'logged_in' : 'unknown', thinking: false, lastStatusAt: 1 }];
      }),
    ) as Record<AIProvider, ProviderState>;

  // The send gate blocks when any listed provider is not sendable, so this list must match what
  // preflight will actually run -- otherwise skips and substitutes are unreachable from the UI.
  it('leaves out a signed-out optional third seat so consult is not blocked', () => {
    expect(seatedProvidersForPreset('consult', 'consult', DEFAULT_MODE_ROLE_ASSIGNMENTS, states(['meta']))?.sort()).toEqual(
      ['chatgpt', 'claude', 'gemini', 'grok'],
    );
  });

  it('lists the standby in place of a signed-out provider it can take over', () => {
    const seated = seatedProvidersForPreset('debate', 'debate', DEFAULT_MODE_ROLE_ASSIGNMENTS, states(['chatgpt']), undefined, 'meta');
    expect(seated).toContain('meta');
    expect(seated).not.toContain('chatgpt');
  });

  // At startup every page is opening and has not reported a session yet. Treating that as signed
  // out swapped Claude and Gemini to Meta AI in a debate for the first seconds after every launch.
  it('keeps the seat of a provider whose page is still opening, so the mode waits for it', () => {
    const opening = states([]);
    opening.claude = { ...opening.claude, webview: 'loaded', dom: 'ready', login: 'unknown' };
    const seated = seatedProvidersForPreset('debate', 'debate', DEFAULT_MODE_ROLE_ASSIGNMENTS, opening, undefined, 'meta');
    expect(seated).toContain('claude');
    expect(seated).not.toContain('meta');
  });

  it('still hands the seat to the standby when the provider was never opened', () => {
    // A never-opened provider is 'unknown' too; waiting for it would block the mode forever.
    const seated = seatedProvidersForPreset('debate', 'debate', DEFAULT_MODE_ROLE_ASSIGNMENTS, states(['claude']), undefined, 'meta');
    expect(seated).toContain('meta');
    expect(seated).not.toContain('claude');
  });

  it('keeps a signed-out provider listed when no standby can take its place', () => {
    expect(seatedProvidersForPreset('debate', 'debate', DEFAULT_MODE_ROLE_ASSIGNMENTS, states(['chatgpt']))).toContain('chatgpt');
  });
});

describe('defaultRolesForPreset with custom assignments', () => {
  it('returns the customized roles for the mode', () => {
    const custom = assignModeRole(
      assignModeRole(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'debate', 'pro', 'gemini'),
      'debate',
      'con',
      'claude',
    );
    expect(defaultRolesForPreset('debate', undefined, custom)).toMatchObject({ pro: 'gemini', con: 'claude' });
  });

  it('brainstorm preset uses the roundtable assignment', () => {
    const custom = assignModeRole(DEFAULT_MODE_ROLE_ASSIGNMENTS, 'roundtable', 'first', 'grok');
    expect(defaultRolesForPreset('free', 'brainstorm', custom)).toMatchObject({ first: 'grok' });
  });
});
