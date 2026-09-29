import type { AIProvider, ModeRoles, ProviderState, SeatProvider } from '../../../shared/types';
import { isSeatedProvider, NO_PROVIDER } from '../../../shared/constants';
import { host } from '../../host';
import type { PreflightResult } from '../preflight';
import { isSendable } from '../sendability';
import type { GraphNode, ProviderRef, RoleKey, WorkflowGraph } from './types';

export function isInactiveStandbyProvider(
  provider: AIProvider,
  activeProviders?: readonly AIProvider[],
): boolean {
  return activeProviders?.includes(provider) === false;
}

export interface RolePlan {
  ok: boolean;
  unavailable: AIProvider[];
  aliased: AIProvider[];
  /** Who actually runs each role; a dropped or unused seat is NO_PROVIDER. */
  roles: Record<RoleKey, SeatProvider>;
  /** Role → the provider it was configured with, for roles the standby took over. */
  substitutions: Record<RoleKey, AIProvider>;
  /** True when `roles` differs from the configured roles. */
  changed: boolean;
}

// The one place that decides who runs a serial graph. Preflight, the send gate, the readiness
// label and the session reset all call it, so they never disagree about skips or substitutes.
// A role whose provider cannot be used is handled in this order: the standby takes over (an
// optional seat it would collide with gives way), an optional seat is dropped, anything else is
// reported as unavailable.
export function planGraphRoles(
  graph: WorkflowGraph,
  roles: ModeRoles | Partial<Record<RoleKey, SeatProvider>> | undefined,
  usable: (provider: AIProvider) => boolean,
  standbyProvider?: AIProvider,
): RolePlan {
  const resolved = resolveGraphRoles(graph, roles);
  const substitutions: Record<RoleKey, AIProvider> = {};
  const unavailable = new Set<AIProvider>();
  let changed = false;
  for (const role of resolveRequiredRoles(graph)) {
    const optional = graph.roles[role]?.optional === true;
    const provider = optional ? resolved.get(role) : providerForRequiredRole(graph, resolved, role);
    if (!provider || usable(provider)) continue;
    const clashes = standbyProvider && usable(standbyProvider) ? aliasClashes(graph, resolved, role, standbyProvider) : undefined;
    if (clashes?.every((other) => graph.roles[other]?.optional === true)) {
      clashes.forEach((other) => resolved.delete(other));
      resolved.set(role, standbyProvider!);
      substitutions[role] = provider;
      changed = true;
    } else if (optional) {
      resolved.delete(role);
      changed = true;
    } else {
      unavailable.add(provider);
    }
  }
  const aliased = graph.preflight.aliasRules?.flatMap((rule) => aliasedProviders(resolved, rule.roles)) ?? [];
  return {
    ok: unavailable.size === 0 && aliased.length === 0,
    unavailable: [...unavailable],
    aliased,
    roles: Object.fromEntries(
      Object.keys(graph.roles).map((role): [RoleKey, SeatProvider] => [role, resolved.get(role) ?? NO_PROVIDER]),
    ),
    substitutions,
    changed,
  };
}

export function isUsableProvider(
  states: ReadonlyMap<AIProvider, ProviderState> | Partial<Record<AIProvider, ProviderState>>,
  activeProviders?: readonly AIProvider[],
): (provider: AIProvider) => boolean {
  const lookup = (provider: AIProvider) =>
    states instanceof Map ? states.get(provider) : (states as Partial<Record<AIProvider, ProviderState>>)[provider];
  return (provider) =>
    !isInactiveStandbyProvider(provider, activeProviders) && isSendable(lookup(provider) ?? missingState(provider));
}

export async function preflightGraph(
  graph: WorkflowGraph,
  roles?: ModeRoles | Partial<Record<RoleKey, SeatProvider>>,
  activeProviders?: readonly AIProvider[],
  standbyProvider?: AIProvider,
): Promise<PreflightResult> {
  if (graph.preflight.kind === 'free') return { ok: true, unavailable: [], aliased: [] };

  const snapshot = await host.connections.get();
  const byProvider = new Map<AIProvider, ProviderState>(snapshot.map((state) => [state.provider, state]));
  const plan = planGraphRoles(graph, roles, isUsableProvider(byProvider, activeProviders), standbyProvider);
  const result: PreflightResult = { ok: plan.ok, unavailable: plan.unavailable, aliased: plan.aliased };
  // Roles are reported only when the run must differ from what was configured.
  if (plan.ok && plan.changed) {
    result.roles = plan.roles;
    result.substitutions = plan.substitutions;
  }
  return result;
}

// Roles that would end up on the same provider as `role` if it were given `provider`.
function aliasClashes(
  graph: WorkflowGraph,
  resolved: Map<RoleKey, AIProvider>,
  role: RoleKey,
  provider: AIProvider,
): RoleKey[] {
  const clashes = (graph.preflight.aliasRules ?? [])
    .filter((rule) => rule.roles.includes(role))
    .flatMap((rule) => rule.roles.filter((other) => other !== role && resolved.get(other) === provider));
  return [...new Set(clashes)];
}

// A 'none' seat is left out of the map; the executor skips the step of an unassigned optional role.
export function resolveGraphRoles(
  graph: WorkflowGraph,
  roles?: ModeRoles | Partial<Record<RoleKey, SeatProvider>>,
): Map<RoleKey, AIProvider> {
  const supplied = roles as Partial<Record<RoleKey, SeatProvider>> | undefined;
  const resolved = new Map<RoleKey, AIProvider>();
  Object.entries(graph.roles).forEach(([role, config]) => {
    const provider = supplied?.[role] ?? config.defaultProvider;
    if (isSeatedProvider(provider)) resolved.set(role, provider);
  });
  return resolved;
}

export function resolveRequiredRoles(graph: WorkflowGraph): RoleKey[] {
  const required = graph.preflight.requiredRoles;
  if (Array.isArray(required)) return [...required];
  if (required === 'allStaticAndPossibleRoles') {
    const roles = new Set<RoleKey>();
    Object.values(graph.nodes).forEach((node) => collectNodeRoles(node, roles));
    return [...roles];
  }
  return Object.keys(graph.roles);
}

function collectNodeRoles(node: GraphNode, roles: Set<RoleKey>): void {
  if (node.kind === 'step') {
    collectProviderRoles(node.provider, roles);
    collectPromptProviderRoles(node.prompt.args, roles);
    return;
  }
  if (node.kind === 'fanout') {
    if (node.over.type === 'roles') node.over.roles.forEach((role) => roles.add(role));
    collectProviderRoles(node.template.provider, roles);
    collectPromptProviderRoles(node.template.prompt.args, roles);
  }
}

function collectPromptProviderRoles(args: { kind: string; provider?: ProviderRef }[], roles: Set<RoleKey>): void {
  args.forEach((arg) => {
    if (arg.provider) collectProviderRoles(arg.provider, roles);
  });
}

function collectProviderRoles(ref: ProviderRef, roles: Set<RoleKey>): void {
  if (ref.type === 'role') roles.add(ref.role);
  else if (ref.type === 'select') ref.possibleRoles.forEach((role) => roles.add(role));
}

function providerForRequiredRole(graph: WorkflowGraph, resolved: Map<RoleKey, AIProvider>, role: RoleKey): AIProvider {
  const provider = resolved.get(role);
  if (!provider) throw new Error(`No provider configured for graph role "${role}" in graph "${graph.id}"`);
  return provider;
}

function aliasedProviders(resolved: Map<RoleKey, AIProvider>, roles: RoleKey[]): AIProvider[] {
  const providers = roles.map((role) => resolved.get(role)).filter((provider): provider is AIProvider => provider !== undefined);
  return providers.filter((provider, index) => providers.indexOf(provider) !== index);
}

function missingState(provider: AIProvider): ProviderState {
  return { provider, webview: 'none', dom: 'unknown', login: 'unknown', thinking: false, lastStatusAt: 0 };
}
