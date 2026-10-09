import type { AIProvider } from '../../shared/types';

const PROVIDER_ERROR_PATTERN = /^\[Error:\s*([\s\S]*?)\]$/;
const SEND_NOT_ACCEPTED_SUFFIX = 'send was not accepted; draft is still in composer';

export class ProviderResponseError extends Error {
  readonly provider: AIProvider;
  readonly response: string;

  constructor(provider: AIProvider, response: string, reason: string) {
    super(reason);
    this.name = 'ProviderResponseError';
    this.provider = provider;
    this.response = response;
  }
}

const PROVIDER_PAGE_RELOADED_REASON = 'provider page reloaded during its turn';

export class ProviderPageReloadedError extends ProviderResponseError {
  constructor(provider: AIProvider) {
    super(provider, `[Error: ${PROVIDER_PAGE_RELOADED_REASON}]`, PROVIDER_PAGE_RELOADED_REASON);
    this.name = 'ProviderPageReloadedError';
  }
}

export function isProviderPageReloadedError(error: unknown): error is ProviderPageReloadedError {
  return error instanceof ProviderPageReloadedError;
}

export function providerResponseError(provider: AIProvider, response: string): ProviderResponseError | undefined {
  const trimmed = response.trim();
  // An empty capture is a failure, not an answer. A step that accepted one fed an empty section
  // into every later prompt ("the pro side pasted nothing"). The engine now reports its own empty
  // captures with a reason; this stays as the backstop for any other route to an empty payload.
  if (!trimmed) return new ProviderResponseError(provider, response, `${provider} returned an empty response`);
  const match = PROVIDER_ERROR_PATTERN.exec(trimmed);
  if (!match) return undefined;
  return new ProviderResponseError(provider, trimmed, match[1].trim());
}

// The page had no answer text yet: the engine gave up after the host's inactivity window, or the
// user pressed "answer is done" too early. The provider may still answer afterwards, so this is a
// slow step, not a broken one.
export function isNoResponseTextError(error: ProviderResponseError): boolean {
  return (
    error.message === `${error.provider} produced no response text` ||
    error.message.startsWith(`${error.provider} captured an empty response`)
  );
}

export function isRetryableSendRejection(error: ProviderResponseError): boolean {
  return error.message.toLowerCase() === `${error.provider} ${SEND_NOT_ACCEPTED_SUFFIX}`;
}
