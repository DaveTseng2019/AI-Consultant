import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider } from '../../shared/types';
import { chooseStepTimeoutAction } from '../workflow';
import { finishProviderResponse } from '../workflow/cancel';
import type { StepTimeoutAction } from '../workflow/stepTimeout';

export function chooseTimeoutDialogAction(action: StepTimeoutAction, onClose: () => void): void {
  chooseStepTimeoutAction(action);
  onClose();
}

/**
 * The user can see a finished answer the detectors have not confirmed. Tell that page to hand the
 * answer over now; the normal RESPONSE_DONE path settles the waiting step from there.
 */
export function takeVisibleAnswer(provider: string): void {
  if (!(provider in AI_PROVIDERS)) return;
  void finishProviderResponse(provider as AIProvider);
}
