import type { AIProvider, SeatProvider } from '../../shared/types';

// The start check itself is preflightGraph in ./graph/preflight; this is the shape it reports.
export interface PreflightResult {
  ok: boolean;
  unavailable: AIProvider[];
  aliased: AIProvider[];
  /** Roles after standby substitution and dropped optional seats; run the graph with these. */
  roles?: Record<string, SeatProvider>;
  /** Role → the provider it was configured with, for roles the standby took over. */
  substitutions?: Record<string, AIProvider>;
}
