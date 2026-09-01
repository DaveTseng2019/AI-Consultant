import type { AIProvider } from '../../shared/types';
import { host } from '../host';

export const WORKFLOW_CANCELLED = 'Workflow cancelled by user';

let workflowAborted = false;
const inFlight = new Set<AIProvider>();
const abortListeners = new Set<(reason: Error) => void>();

export function resetCancelState(): void {
  workflowAborted = false;
  inFlight.clear();
}

export function markInFlight(provider: AIProvider): void {
  inFlight.add(provider);
}

export function clearInFlight(provider: AIProvider): void {
  inFlight.delete(provider);
}

export function getInFlightProviders(): AIProvider[] {
  return [...inFlight];
}

export function abortWorkflow(): void {
  workflowAborted = true;
  const reason = new Error(WORKFLOW_CANCELLED);
  for (const listener of [...abortListeners]) listener(reason);
}

export function checkAborted(): void {
  if (workflowAborted) throw new Error(WORKFLOW_CANCELLED);
}

export function onWorkflowAbort(listener: (reason: Error) => void): () => void {
  abortListeners.add(listener);
  return () => abortListeners.delete(listener);
}

export async function stopProvider(provider: AIProvider): Promise<void> {
  await host.provider.eval(
    provider,
    "window.__MAC_ENGINE__ && typeof window.__MAC_ENGINE__.stop === 'function' && window.__MAC_ENGINE__.stop();",
  ).catch(() => undefined);
}

/** Take the answer the user can already see, instead of waiting for the detectors to confirm it. */
export async function finishProviderResponse(provider: AIProvider): Promise<void> {
  await host.provider.eval(
    provider,
    "window.__MAC_ENGINE__ && typeof window.__MAC_ENGINE__.finish === 'function' && window.__MAC_ENGINE__.finish();",
  ).catch(() => undefined);
}
