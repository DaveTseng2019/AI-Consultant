import type { AIProvider } from '../../shared/types';
import { resetProviderPullState } from '../bridge/pull';
import {
  abortWorkflow,
  checkAborted,
  getInFlightProviders,
  onWorkflowAbort,
  stopProvider,
  takeLateProviderResponse,
} from './cancel';
import {
  isNoResponseTextError,
  isProviderPageReloadedError,
  isRetryableSendRejection,
  providerResponseError,
  ProviderResponseError,
} from './providerResponse';
import { sendAndWait } from './sendAndWait';
import { SKIP_RESPONSE } from './state';
import { awaitStepTimeoutAction, emitCountdown } from './stepTimeout';
import { tearDownWaiters } from './teardown';

export const SEND_REJECTION_RETRY_DELAY_MS = 1_500;

export interface RunStepOptions {
  recoverProviderErrors?: boolean;
}

function waitForSendRetry(): Promise<void> {
  checkAborted();
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      unsubscribe();
      resolve();
    }, SEND_REJECTION_RETRY_DELAY_MS);
    const unsubscribe = onWorkflowAbort((reason) => {
      globalThis.clearTimeout(timer);
      unsubscribe();
      reject(reason);
    });
  });
}

export async function runStep(
  provider: AIProvider,
  prompt: string,
  reservedTurn?: number,
  options: RunStepOptions = {},
): Promise<{ response: string; turn: number }> {
  let sendRejectionRetries = 0;
  for (;;) {
    checkAborted();
    emitCountdown(provider);
    try {
      const result = await sendAndWait(provider, prompt, reservedTurn);
      const responseError = providerResponseError(provider, result.response);
      if (!responseError) return result;
      if (sendRejectionRetries === 0 && isRetryableSendRejection(responseError)) {
        sendRejectionRetries += 1;
        await waitForSendRetry();
        continue;
      }
      throw responseError;
    } catch (error) {
      checkAborted();
      const providerError = error instanceof ProviderResponseError && !isNoResponseTextError(error);
      if (providerError && options.recoverProviderErrors !== true) throw error;
      const failureKind = providerError ? 'provider-error' : 'timeout';
      const recoveryDetail = isProviderPageReloadedError(error) ? 'provider-page-reloaded' : undefined;
      let action = await awaitStepTimeoutAction(provider, failureKind, recoveryDetail);
      // The user says the answer arrived after all. Only the page can confirm it, so read it; when
      // nothing newer than the send is there, ask again rather than pass an old answer downstream.
      while (action === 'take') {
        const late = await takeLateProviderResponse(provider);
        if (late.trim()) return { response: late, turn: reservedTurn ?? -1 };
        action = await awaitStepTimeoutAction(provider, failureKind, recoveryDetail, true);
      }
      if (action === 'retry') {
        await stopProvider(provider);
        resetProviderPullState(provider);
        continue;
      }
      if (action === 'skip') return { response: SKIP_RESPONSE, turn: -1 };
      if (action === 'cancel') {
        abortWorkflow();
        await stopProvider(provider);
        await tearDownWaiters(getInFlightProviders(), { stopClick: true });
      }
      throw error;
    }
  }
}
