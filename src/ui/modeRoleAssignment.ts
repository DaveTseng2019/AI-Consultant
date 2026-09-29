import type { AIProvider, CodingRoles, ConsultRoles, DebateRoles, RoundtableRoles, SeatProvider } from '../../shared/types';
import {
  AI_PROVIDERS,
  isSeatedProvider,
  NO_PROVIDER,
  DEFAULT_CODING_ROLES,
  DEFAULT_CONSULT_ROLES,
  DEFAULT_DEBATE_ROLES,
  DEFAULT_ROUNDTABLE_ROLES,
} from '../../shared/constants';
import type { I18nKey } from '../i18n/keys';
import { workflowGraphs } from '../workflow/graph/builtinGraphs';

// Per-mode role→provider assignments the user can customize in Settings.
// Roles may reuse the same provider (e.g. a two-AI debate) — the runtime
// preflight (parallelAliases) rejects only the parallel-role collisions.
export interface ModeRoleAssignments {
  debate: DebateRoles;
  consult: ConsultRoles;
  coding: CodingRoles;
  roundtable: RoundtableRoles;
}

export const DEFAULT_MODE_ROLE_ASSIGNMENTS: ModeRoleAssignments = {
  debate: { ...DEFAULT_DEBATE_ROLES },
  consult: { ...DEFAULT_CONSULT_ROLES },
  coding: { ...DEFAULT_CODING_ROLES },
  roundtable: { ...DEFAULT_ROUNDTABLE_ROLES },
};

// v1.7-v1.8 duplicated one provider in each setup to keep Grok optional. This
// table is consumed only by the versioned, one-time settings migration below.
const LEGACY_THREE_PROVIDER_DEFAULTS: ModeRoleAssignments = {
  debate: { pro: 'chatgpt', con: 'claude', judge: 'gemini', summary: 'gemini' },
  consult: { first: 'chatgpt', second: 'gemini', third: NO_PROVIDER, reviewer: 'claude', summary: 'gemini' },
  coding: { planner: 'gemini', reviewer: 'chatgpt', coder: 'claude', tester: 'chatgpt' },
  roundtable: { first: 'claude', second: 'gemini', third: 'chatgpt', fourth: 'claude' },
};

// Role keys per mode, in execution order — drives the Settings UI rows.
export const MODE_ROLE_FIELDS = {
  debate: ['pro', 'con', 'judge', 'summary'],
  consult: ['first', 'second', 'third', 'reviewer', 'summary'],
  coding: ['planner', 'reviewer', 'coder', 'tester'],
  roundtable: ['first', 'second', 'third', 'fourth'],
} as const satisfies Record<keyof ModeRoleAssignments, readonly string[]>;

export const MODE_ROLE_MODE_LABEL_KEYS: Record<keyof ModeRoleAssignments, I18nKey> = {
  debate: 'preset.debate.displayName',
  consult: 'preset.consult.displayName',
  coding: 'preset.coding.displayName',
  roundtable: 'preset.roundtable.displayName',
};

export const MODE_ROLE_LABEL_KEYS: Record<keyof ModeRoleAssignments, Record<string, I18nKey>> = {
  debate: {
    pro: 'workflowRole.debate.pro',
    con: 'workflowRole.debate.con',
    judge: 'workflowRole.debate.judge',
    summary: 'workflowRole.debate.summary',
  },
  consult: {
    first: 'workflowRole.consult.first',
    second: 'workflowRole.consult.second',
    third: 'workflowRole.consult.third',
    reviewer: 'workflowRole.consult.reviewer',
    summary: 'workflowRole.consult.summary',
  },
  coding: {
    planner: 'settings.modeRoles.coding.planner',
    reviewer: 'settings.modeRoles.coding.reviewer',
    coder: 'settings.modeRoles.coding.coder',
    tester: 'settings.modeRoles.coding.tester',
  },
  roundtable: {
    first: 'settings.modeRoles.roundtable.first',
    second: 'settings.modeRoles.roundtable.second',
    third: 'settings.modeRoles.roundtable.third',
    fourth: 'settings.modeRoles.roundtable.fourth',
  },
};

// The graph declares which seats may be left unused; Settings reads the same flag.
export function isOptionalModeRole(mode: keyof ModeRoleAssignments, role: string): boolean {
  return workflowGraphs[mode].roles[role]?.optional === true;
}

export function isDefaultModeRoles(assignments: ModeRoleAssignments, mode: keyof ModeRoleAssignments): boolean {
  const current = assignments[mode] as unknown as Record<string, SeatProvider>;
  const defaults = DEFAULT_MODE_ROLE_ASSIGNMENTS[mode] as unknown as Record<string, SeatProvider>;
  return MODE_ROLE_FIELDS[mode].every((role) => current[role] === defaults[role]);
}

// Resets one mode only; the other modes keep what the user set.
export function restoreModeRoles(assignments: ModeRoleAssignments, mode: keyof ModeRoleAssignments): ModeRoleAssignments {
  return { ...assignments, [mode]: { ...DEFAULT_MODE_ROLE_ASSIGNMENTS[mode] } };
}

// Seats that answer side by side and include an optional seat (consult's first/second/third).
// Their order carries no meaning, so any of them can be emptied as long as the required ones fill.
function answerSeats(mode: keyof ModeRoleAssignments): string[] {
  const rule = workflowGraphs[mode].preflight.aliasRules?.find((candidate) =>
    candidate.roles.some((role) => isOptionalModeRole(mode, role)),
  );
  return rule ? [...rule.roles] : [];
}

// The send-target strip seats or unseats a provider. Unticking an answerer moves the answerers
// after it up and leaves the last answer seat unused; unticking a provider in another optional
// seat (consult's summary) leaves that seat unused. Ticking an unseated provider puts it back in
// its default seat when that is free, else in the first free answer seat, else in a free optional
// seat. Undefined means the chip stays frozen: the provider holds a required seat outside the
// answer seats (consult's reviewer), removing it would leave a required answer seat empty, or no
// seat is free.
export function toggleOptionalSeat(
  assignments: ModeRoleAssignments,
  mode: keyof ModeRoleAssignments,
  provider: AIProvider,
): ModeRoleAssignments | undefined {
  const roles = assignments[mode] as unknown as Record<string, SeatProvider>;
  const fields = MODE_ROLE_FIELDS[mode] as readonly string[];
  const seats = answerSeats(mode);
  const looseSeats = fields.filter((role) => !seats.includes(role) && isOptionalModeRole(mode, role));
  const fixedSeats = fields.filter((role) => !seats.includes(role) && !looseSeats.includes(role));
  if (fixedSeats.some((role) => roles[role] === provider)) return undefined;

  const seated = seats.map((role) => roles[role]).filter(isSeatedProvider);
  const fillAnswers = (current: ModeRoleAssignments, answers: AIProvider[]) =>
    seats.reduce((next, role, index) => assignModeRole(next, mode, role, answers[index] ?? NO_PROVIDER), current);

  if (seated.includes(provider) || looseSeats.some((role) => roles[role] === provider)) {
    const answers = seated.filter((candidate) => candidate !== provider);
    if (answers.length < seats.filter((role) => !isOptionalModeRole(mode, role)).length) return undefined;
    return looseSeats.reduce(
      (next, role) => (roles[role] === provider ? assignModeRole(next, mode, role, NO_PROVIDER) : next),
      fillAnswers(assignments, answers),
    );
  }

  const defaults = DEFAULT_MODE_ROLE_ASSIGNMENTS[mode] as unknown as Record<string, SeatProvider>;
  const home = looseSeats.find((role) => defaults[role] === provider && roles[role] === NO_PROVIDER);
  if (home) return assignModeRole(assignments, mode, home, provider);
  if (seated.length < seats.length) return fillAnswers(assignments, [...seated, provider]);
  const free = looseSeats.find((role) => roles[role] === NO_PROVIDER);
  return free ? assignModeRole(assignments, mode, free, provider) : undefined;
}

const PROVIDERS = Object.keys(AI_PROVIDERS) as AIProvider[];

function isProvider(value: unknown): value is AIProvider {
  return typeof value === 'string' && PROVIDERS.includes(value as AIProvider);
}

export function normalizeModeRoleAssignments(
  value: unknown,
  fallback: ModeRoleAssignments = DEFAULT_MODE_ROLE_ASSIGNMENTS,
): ModeRoleAssignments {
  const input = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ModeRoleAssignments, unknown>>;
  const out = {} as Record<keyof ModeRoleAssignments, Record<string, SeatProvider>>;

  (Object.keys(MODE_ROLE_FIELDS) as (keyof ModeRoleAssignments)[]).forEach((mode) => {
    const supplied = (input[mode] && typeof input[mode] === 'object' ? input[mode] : {}) as Record<string, unknown>;
    const defaults = fallback[mode] as unknown as Record<string, SeatProvider>;
    const next: Record<string, SeatProvider> = {};
    for (const role of MODE_ROLE_FIELDS[mode]) {
      const value = supplied[role];
      const noneAllowed = value === NO_PROVIDER && isOptionalModeRole(mode, role);
      next[role] = isProvider(value) || noneAllowed ? (value as SeatProvider) : defaults[role];
    }
    out[mode] = next;
  });

  return out as unknown as ModeRoleAssignments;
}

export function migrateLegacyModeRoleAssignments(
  value: unknown,
  fallback: ModeRoleAssignments = DEFAULT_MODE_ROLE_ASSIGNMENTS,
): ModeRoleAssignments {
  const migrated = normalizeModeRoleAssignments(value, fallback);
  if (!value || typeof value !== 'object') return migrated;
  const input = value as Partial<Record<keyof ModeRoleAssignments, unknown>>;
  const output = migrated as unknown as Record<keyof ModeRoleAssignments, Record<string, AIProvider>>;

  for (const mode of Object.keys(MODE_ROLE_FIELDS) as (keyof ModeRoleAssignments)[]) {
    if (!input[mode] || typeof input[mode] !== 'object') continue;
    const supplied = input[mode] as Record<string, unknown>;
    const legacyDefaults = LEGACY_THREE_PROVIDER_DEFAULTS[mode] as unknown as Record<string, AIProvider>;
    const isExactLegacyDefault = MODE_ROLE_FIELDS[mode].every(
      (role) => isOptionalModeRole(mode, role) || supplied[role] === legacyDefaults[role],
    );
    if (isExactLegacyDefault) {
      output[mode] = { ...(fallback[mode] as unknown as Record<string, AIProvider>) };
    }
  }

  return migrated;
}

export function assignModeRole(
  assignments: ModeRoleAssignments,
  mode: keyof ModeRoleAssignments,
  role: string,
  provider: SeatProvider,
): ModeRoleAssignments {
  return { ...assignments, [mode]: { ...assignments[mode], [role]: provider } };
}

/**
 * Swap a provider out of every persisted collaboration seat. This is used
 * when the four-active-provider lineup changes: the previous standby takes
 * the exact seats that belonged to the newly selected standby provider.
 */
export function replaceModeRoleProvider(
  assignments: ModeRoleAssignments,
  removed: AIProvider,
  added: AIProvider,
): ModeRoleAssignments {
  const next = {} as Record<keyof ModeRoleAssignments, Record<string, AIProvider>>;

  for (const mode of Object.keys(MODE_ROLE_FIELDS) as (keyof ModeRoleAssignments)[]) {
    const current = assignments[mode] as unknown as Record<string, AIProvider>;
    next[mode] = Object.fromEntries(
      MODE_ROLE_FIELDS[mode].map((role) => [role, current[role] === removed ? added : current[role]]),
    );
  }

  return next as unknown as ModeRoleAssignments;
}

/** Repair corrupted or pre-feature settings without ever assigning standby. */
export function keepModeRolesWithinProviders(
  assignments: ModeRoleAssignments,
  providers: readonly AIProvider[],
): ModeRoleAssignments {
  const allowed = new Set<SeatProvider>(providers);
  const next = {} as Record<keyof ModeRoleAssignments, Record<string, SeatProvider>>;

  for (const mode of Object.keys(MODE_ROLE_FIELDS) as (keyof ModeRoleAssignments)[]) {
    const current = assignments[mode] as unknown as Record<string, SeatProvider>;
    const repaired: Record<string, SeatProvider> = {};
    const providersAlreadyAssigned = new Set<SeatProvider>(
      MODE_ROLE_FIELDS[mode]
        .map((role) => current[role])
        .filter((provider) => allowed.has(provider)),
    );
    for (const role of MODE_ROLE_FIELDS[mode]) {
      const candidate = current[role];
      if (allowed.has(candidate) || (candidate === NO_PROVIDER && isOptionalModeRole(mode, role))) {
        repaired[role] = candidate;
        continue;
      }
      const alreadyUsed = new Set(Object.values(repaired));
      const replacement =
        providers.find((provider) => !providersAlreadyAssigned.has(provider)) ??
        providers.find((provider) => !alreadyUsed.has(provider)) ??
        providers[0];
      repaired[role] = replacement;
      providersAlreadyAssigned.add(replacement);
    }
    next[mode] = repaired;
  }

  return next as unknown as ModeRoleAssignments;
}
