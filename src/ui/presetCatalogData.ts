import { DEFAULT_FREE_TARGET_PROVIDERS, seatedProviders } from '../../shared/constants';
import type { AIProvider, ChatMode, ModeRoles, ProviderState, SeatProvider, WorkflowPresetId } from '../../shared/types';
import { isUsableProvider, planGraphRoles, workflowGraphs } from '../workflow/graph';
import { DEFAULT_MODE_ROLE_ASSIGNMENTS, type ModeRoleAssignments } from './modeRoleAssignment';
import type { I18nKey } from '../i18n/keys';

export interface PresetCatalogEntry {
  id: WorkflowPresetId;
  graphId: ChatMode;
  displayNameKey: I18nKey;
  metaKey?: I18nKey;
  descriptionKey: I18nKey;
  costLabelKey: I18nKey;
  requiredProviders: AIProvider[];
  estMinutes: number;
  ramHint: 'low' | 'medium' | 'high';
  source: 'builtin' | 'imported' | 'community';
}

const DEFAULT_REQUIRED_PROVIDERS = [...DEFAULT_FREE_TARGET_PROVIDERS] as AIProvider[];

export const PRESET_CATALOG: PresetCatalogEntry[] = [
  {
    id: 'free',
    graphId: 'free',
    displayNameKey: 'preset.free.displayName',
    metaKey: 'preset.free.meta',
    descriptionKey: 'preset.free.description',
    costLabelKey: 'preset.free.costLabel',
    requiredProviders: [],
    estMinutes: 1,
    ramHint: 'low',
    source: 'builtin',
  },
  {
    id: 'debate',
    graphId: 'debate',
    displayNameKey: 'preset.debate.displayName',
    metaKey: 'preset.debate.meta',
    descriptionKey: 'preset.debate.description',
    costLabelKey: 'preset.debate.costLabel',
    requiredProviders: DEFAULT_REQUIRED_PROVIDERS,
    estMinutes: 4,
    ramHint: 'medium',
    source: 'builtin',
  },
  {
    id: 'consult',
    graphId: 'consult',
    displayNameKey: 'preset.consult.displayName',
    metaKey: 'preset.consult.meta',
    descriptionKey: 'preset.consult.description',
    costLabelKey: 'preset.consult.costLabel',
    requiredProviders: DEFAULT_REQUIRED_PROVIDERS,
    estMinutes: 2,
    ramHint: 'low',
    source: 'builtin',
  },
  {
    id: 'coding',
    graphId: 'coding',
    displayNameKey: 'preset.coding.displayName',
    metaKey: 'preset.coding.meta',
    descriptionKey: 'preset.coding.description',
    costLabelKey: 'preset.coding.costLabel',
    requiredProviders: DEFAULT_REQUIRED_PROVIDERS,
    estMinutes: 10,
    ramHint: 'high',
    source: 'builtin',
  },
  {
    id: 'roundtable',
    graphId: 'roundtable',
    displayNameKey: 'preset.roundtable.displayName',
    metaKey: 'preset.roundtable.meta',
    descriptionKey: 'preset.roundtable.description',
    costLabelKey: 'preset.roundtable.costLabel',
    requiredProviders: DEFAULT_REQUIRED_PROVIDERS,
    estMinutes: 12,
    ramHint: 'high',
    source: 'builtin',
  },
  {
    id: 'brainstorm',
    graphId: 'free',
    displayNameKey: 'preset.brainstorm.displayName',
    metaKey: 'preset.brainstorm.meta',
    descriptionKey: 'preset.brainstorm.description',
    costLabelKey: 'preset.brainstorm.costLabel',
    requiredProviders: DEFAULT_REQUIRED_PROVIDERS,
    estMinutes: 10,
    ramHint: 'medium',
    source: 'builtin',
  },
];

export function presetForId(presetId: WorkflowPresetId): PresetCatalogEntry {
  return PRESET_CATALOG.find((preset) => preset.id === presetId) ?? PRESET_CATALOG[0];
}

// Who would run each role of the preset right now, after skipped seats and standby substitutes;
// undefined for free mode. The send gate, the readiness label and the role badges use it so they
// agree with preflight.
export function plannedRolesForPreset(
  mode: ChatMode,
  presetId: WorkflowPresetId | undefined,
  assignments: ModeRoleAssignments | undefined,
  states: Partial<Record<AIProvider, ProviderState>>,
  activeProviders?: readonly AIProvider[],
  standbyProvider?: AIProvider,
): Record<string, SeatProvider> | undefined {
  const roles = defaultRolesForPreset(mode, presetId, assignments);
  if (!roles) return undefined;
  const graph = workflowGraphs[presetId === 'brainstorm' ? 'brainstorm' : mode];
  return planGraphRoles(graph, roles, isUsableProvider(states, activeProviders), standbyProvider).roles;
}

export function seatedProvidersForPreset(
  ...args: Parameters<typeof plannedRolesForPreset>
): AIProvider[] | undefined {
  const roles = plannedRolesForPreset(...args);
  return roles && seatedProviders(roles);
}

export function defaultRolesForPreset(
  mode: ChatMode,
  presetId?: WorkflowPresetId,
  assignments: ModeRoleAssignments = DEFAULT_MODE_ROLE_ASSIGNMENTS,
): ModeRoles | undefined {
  if (presetId === 'brainstorm') return { ...assignments.roundtable };
  if (mode === 'free') return undefined;
  if (mode === 'debate') return { ...assignments.debate };
  if (mode === 'consult') return { ...assignments.consult };
  if (mode === 'coding') return { ...assignments.coding };
  return { ...assignments.roundtable };
}
