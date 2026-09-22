import type { AIProvider, BridgeMessage } from '../shared/types';
import { isProviderChallengeActive } from './challenge';
import { buildReportDigest, type ReportElement } from './reportDigest';
import { finalResponseText, serializeResponseText } from './responseSerializer';

type InputStrategyName = 'default' | 'prosemirror-paste' | 'quill-angular';
type SendStrategy = 'click' | 'enter';

interface DetectorObject {
  selector: string;
  textIncludes?: string;
  textExcludes?: string;
}

type Detector = string | DetectorObject;
type ChallengeMutationGuard = () => void;

interface AdapterConfig {
  provider: AIProvider;
  adapterVersion: number;
  inputSelectors: string[];
  sendButtonSelectors: string[];
  responseSelectors: string[];
  loginDetectors: string[];
  loggedOutDetectors?: Detector[];
  thinkingDetectors?: Detector[];
  stopButtonSelectors?: string[];
  inputStrategy: InputStrategyName;
  sendStrategy?: SendStrategy;
  timing?: {
    doneDelayMs?: number;
    chunkDebounceMs?: number;
    statusIntervalMs?: number;
    backupPollMs?: number;
  };
}

interface MacEngineState {
  bootId: string;
  adapterVersion: number;
  stop?: () => void;
  finish?: () => void;
}

type InputStrategy = (el: Element, text: string, assertCanMutate: ChallengeMutationGuard) => void | Promise<void>;

interface RetryLookupOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

interface SendActivationResult {
  ok: boolean;
  path: 'button-click' | 'enter-key';
  detail?: string;
}

const SELECTOR_RETRY_INTERVAL_MS = 250;
const INPUT_SELECTOR_TIMEOUT_MS = 2500;
const SEND_BUTTON_SELECTOR_TIMEOUT_MS = 800;
const PRE_SEND_DELAY_MS = 800;
const SEND_RETRY_DELAY_MS = 1500;
const SEND_FINAL_VERIFY_DELAY_MS = 1500;
// A pasted image is uploaded by the provider before it counts as an attachment, and a send fired
// during that upload either drops it or is refused. Wait after each paste.
// notes: a fixed wait, not a signal that the upload finished -- every provider shows that
//        differently. Watch the composer for the thumbnail if a slow connection drops images.
const IMAGE_PASTE_SETTLE_MS = 2000;
// Long enough for ProseMirror to re-render the composer from its own document. A check in the
// same tick reads the DOM we just wrote, not the state the editor will settle on.
const COMPOSER_SETTLE_MS = 300;
const CHATGPT_INITIAL_SEND_CONFIRMATION_DELAY_MS = 10_000;
const CHATGPT_FALLBACK_SEND_CONFIRMATION_DELAY_MS = 4_000;
const CHATGPT_USER_MESSAGE_SELECTOR = '[data-message-author-role="user"]';
const GROK_LIVE_STOP_BUTTON_SELECTOR = 'button[data-testid="chat-stop-button"]';
const GROK_LIVE_TEXTAREA_SELECTORS = [
  '[data-testid="chat-input"] textarea[aria-label="Ask Grok anything"]',
  'textarea[aria-label="Ask Grok anything"]',
  '[data-testid="chat-input"] textarea',
];
const CHATGPT_TERMINAL_SAMPLE_INTERVAL_MS = 400;
const CHATGPT_TERMINAL_MIN_STABLE_MS = 1200;
const CHATGPT_TERMINAL_MIN_SAMPLES = 3;
const DOCUMENT_POSITION_DISCONNECTED = 0x01;
const DOCUMENT_POSITION_FOLLOWING = 0x04;
const USER_MESSAGE_ANCESTOR_SELECTOR = [
  '[data-message-author-role="user"]',
  '[data-testid="user-message"]',
  'div[id^="response-"].items-end',
  '.message-bubble.user',
].join(', ');

// A finished ChatGPT turn grows a copy button, without needing hover. The stop button is removed
// before the last render batch lands, and multi-step answers (search, reasoning) can drop it
// entirely during an intermediate pause, so relying on it alone reads a pause as "finished".
// This second signal covers the window the stop button cannot see.
//
// This lives in the engine rather than the adapter JSON on purpose: thinkingDetectors is a flat
// selector array that cannot express "the last turn is missing this element", and its seed values
// are pinned by the frozen seed table in scripts/check-adapters.mjs.
const TURN_COMPLETION_SIGNALS: Partial<Record<AIProvider, { turn: string; complete: string }>> = {
  chatgpt: {
    turn: '[data-testid^="conversation-turn-"]',
    complete: '[data-testid="copy-turn-action-button"]',
  },
  // Grok needs the same cover, and needs it more: measured on grok.com 2026-08-28, none of its
  // thinkingDetectors fire at all. The stop button carries no data-testid and its aria-label is
  // translated ("停止模型響應"), [data-streaming] never appears, and .thinking-container reads
  // "運作了 6 秒" rather than "Thinking". isThinking() is therefore false for the whole turn, so an
  // answer that pauses over doneDelayMs to run a search was finished on its opening line alone.
  // Every turn owns an .action-buttons bar. It is created empty with the turn and fills with the
  // copy/share/rate buttons only once the answer is complete, so the last bar in the document
  // holding no button is the one signal that survives a UI language change.
  grok: {
    turn: '.action-buttons',
    complete: 'button',
  },
};

const CHATGPT_STRONG_ACTIVITY_SELECTORS = [
  '[aria-busy="true"]',
  '[data-streaming="true"]',
  '[data-is-streaming="true"]',
  'span.loading-shimmer',
  '.loading-shimmer',
  '[class*="loading-shimmer"]',
];
const CHATGPT_PROGRESS_SELECTORS = ['[role="progressbar"]', 'progress'];
const CHATGPT_EXTERNAL_STATUS_SELECTORS = ['[role="status"]'];
const CHATGPT_EXTERNAL_LIVE_REGION_SELECTORS = ['[aria-live]'];
const CHATGPT_VERIFIED_SIDECAR_SELECTORS = ['[data-testid*="thinking"]', '[data-testid*="reasoning"]'];
const CHATGPT_TURN_STATUS_SELECTORS = [
  ...CHATGPT_EXTERNAL_STATUS_SELECTORS,
  ...CHATGPT_EXTERNAL_LIVE_REGION_SELECTORS,
  ...CHATGPT_VERIFIED_SIDECAR_SELECTORS,
  '[class*="thinking"]',
  '[class*="reasoning"]',
];
const CHATGPT_ACTIVE_STATUS_LABELS = [
  'thinking',
  'pro thinking',
  'thinking longer for a better answer',
  'reasoning',
  'finalizing answer',
  'finalizing',
  'analyzing',
  'researching',
  'working on it',
  'working',
  'planning',
  'searching the web',
  'searching',
  'reading',
];
const CHATGPT_EXTERNAL_ACTIVE_STATUS_LABELS = [
  'thinking',
  'pro thinking',
  'thinking longer for a better answer',
  'reasoning',
  'finalizing answer',
  'finalizing',
];
const CHATGPT_STRONG_STOP_SELECTORS = [
  '[data-testid="stop-button"]',
  'button[data-testid="composer-stop-button"]',
  'button[aria-label="Stop generating"]',
  'button[aria-label="Stop streaming"]',
  'button[aria-label="Stop"]',
];

// Fail closed after the shipped 10-minute inactivity window if the positive completion signal
// never arrives. A selector rename must surface a retryable error instead of silently returning a
// partial answer, while fresh response text or the ordinary thinking detectors keep the wait alive.
const TURN_COMPLETION_CONFIRM_TIMEOUT_MS = 600_000;

const NATIVE_TURN_POLL_MS = 400;
const NATIVE_TURN_CONFIRM_TIMEOUT_MS = 8000;

interface ChatGptTerminalGateState {
  turn: Element | null;
  response: Element | null;
  completion: Element | null;
  responseText: string;
  stableSince: number;
  samples: number;
}

interface ResponseCandidate {
  element: Element;
  text: string;
}

export function isLikelyPromptEcho(responseText: string, promptText: string): boolean {
  const trimmedResponse = responseText.trim();
  const trimmedPrompt = promptText.trim();
  if (trimmedResponse && trimmedResponse === trimmedPrompt) return true;

  const responseKey = promptEchoComparisonKey(responseText);
  const promptKey = promptEchoComparisonKey(promptText);
  if (!responseKey || !promptKey) return false;
  if (responseKey === promptKey) return true;

  const shorterLength = Math.min(responseKey.length, promptKey.length);
  const longerLength = Math.max(responseKey.length, promptKey.length);
  if (shorterLength < 40 || shorterLength / longerLength < 0.9) return false;
  if (responseKey.includes(promptKey) || promptKey.includes(responseKey)) return true;

  const sampleLength = Math.min(80, Math.floor(shorterLength / 3));
  return (
    responseKey.slice(0, sampleLength) === promptKey.slice(0, sampleLength) &&
    responseKey.slice(-sampleLength) === promptKey.slice(-sampleLength)
  );
}

function promptEchoComparisonKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[^\r\n]*[\r\n]?/g, '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

export async function retryLookup<T>(lookup: () => T | null | undefined, options: RetryLookupOptions = {}): Promise<T | null> {
  const intervalMs = Math.max(1, options.intervalMs ?? SELECTOR_RETRY_INTERVAL_MS);
  const timeoutMs = Math.max(0, options.timeoutMs ?? INPUT_SELECTOR_TIMEOUT_MS);
  const startedAt = Date.now();

  while (true) {
    const found = lookup();
    if (found) return found;

    const elapsed = Date.now() - startedAt;
    if (elapsed >= timeoutMs) return null;

    await sleep(Math.min(intervalMs, timeoutMs - elapsed));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

// The clipboard cannot be read from an injected script, so the image arrives as a data URL and is
// rebuilt into a File here. Pasting that File is what every provider's composer already understands;
// nothing about it is provider-specific, which is why it lives beside the input strategies.
function fileFromDataUrl(dataUrl: string): File | undefined {
  const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return undefined;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const subtype = match[1].slice('image/'.length);
    const extension = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/gi, '') || 'png';
    return new File([bytes], `pasted-image.${extension}`, { type: match[1] });
  } catch {
    return undefined;
  }
}

class InputInjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputInjectionError';
  }
}

class ChallengeActiveError extends Error {
  constructor() {
    super('security challenge is active');
    this.name = 'ChallengeActiveError';
  }
}

class InactiveSendOperationError extends Error {
  constructor() {
    super('send operation is no longer active');
    this.name = 'InactiveSendOperationError';
  }
}

(function engine() {
  if (typeof window === 'undefined') return;
  if (window.self !== window.top) return;
  if (!window.__MAC_BRIDGE__) return;

  const bridge = window.__MAC_BRIDGE__;
  const existing = window.__MAC_ENGINE__ as MacEngineState | undefined;
  if (existing?.bootId === bridge.bootId) return;

  let adapter: AdapterConfig | undefined;
  let statusInterval: number | undefined;
  let responseTimeout: number | undefined;
  let finishResponseTimeout: number | undefined;
  let checkDoneInterval: number | undefined;
  let pollInterval: number | undefined;
  let lastSeenResponseEl: Element | null = null;
  let responseBaselineEls = new Set<Element>();
  let responseBaselineTextCounts = new Map<string, number>();
  let waitingForResponse = false;
  let responseGeneration = 0;
  let activeResponseGeneration = 0;
  let nextSendOperation = 0;
  let activeSendOperation: number | undefined;
  let draftStaging = false;
  let lastResponseText = '';
  let lastCompletionActivityAt = 0;
  let pendingPromptText = '';
  let injectionStageTrail = '';
  let nativeDraftText = '';
  let nativeResponseBaseline: Element[] = [];
  let nativeAdoptPending = false;
  let matchingChatGptUserTurnBaseline = 0;
  let activeChatGptUserTurnAnchor: Element | null = null;
  let lastChunkTime = 0;
  let lastActivatedInput: Element | null = null;
  let chatGptTerminalGate: ChatGptTerminalGateState = emptyChatGptTerminalGate();

  window.__MAC_ENGINE__ = {
    bootId: bridge.bootId,
    adapterVersion: 0,
    stop,
    // The user can see a finished answer that the detectors have not confirmed yet. finish()
    // ends the wait by reading the response exactly as the normal completion path does.
    finish: () => finishResponse(),
  };

  (window as unknown as { __MAC_REPORT__?: unknown }).__MAC_REPORT__ = {
    collect(adapterJson: unknown, appVersion: string) {
      try {
        const adapter = typeof adapterJson === 'string' ? JSON.parse(adapterJson) : adapterJson;
        return buildReportDigest(adapter as Parameters<typeof buildReportDigest>[0], {
          href: location.href,
          appVersion,
          querySelectorAll: (selector: string) =>
            Array.from(document.querySelectorAll(selector)) as unknown as ReportElement[],
        });
      } catch {
        return null;
      }
    },
  };

  const inputStrategies: Record<InputStrategyName, InputStrategy> = {
    default: defaultInjectInput,
    'prosemirror-paste': prosemirrorPasteInput,
    'quill-angular': quillAngularInput,
  };

  bridge.onDispatch((message: BridgeMessage) => {
    if (message.action === 'ADAPTER_UPDATE') {
      installAdapter(message.payload as AdapterConfig);
      return;
    }
    if (message.action === 'SEND_MESSAGE' && (!adapter || !message.provider || message.provider === adapter.provider)) {
      const sendOperation = beginSendOperation(message.provider);
      if (sendOperation === undefined) return;
      if (abortAutomationForChallenge(message.provider, true, 'send', sendOperation)) return;
      if (rejectSendWhileProviderGenerating(message.provider, sendOperation)) return;
      const payload = message.payload as { text?: string; images?: string[] } | undefined;
      void sendMessage(payload?.text ?? '', message.provider, sendOperation, payload?.images ?? []);
      return;
    }
    if (message.action === 'FILL_DRAFT' && (!adapter || !message.provider || message.provider === adapter.provider)) {
      if (!beginFillOperation(message.provider)) return;
      if (abortAutomationForChallenge(message.provider, false, 'fill')) {
        releaseFillOperation();
        return;
      }
      const payload = message.payload as { text?: string } | undefined;
      void fillDraft(payload?.text ?? '', message.provider).finally(releaseFillOperation);
      return;
    }
    if (message.action === 'CHECK_STATUS') {
      reportStatus();
    }
  });

  function installAdapter(next: AdapterConfig) {
    const state = window.__MAC_ENGINE__ as MacEngineState;
    if (adapter && next.adapterVersion < adapter.adapterVersion) return;
    adapter = next;
    state.adapterVersion = next.adapterVersion;
    if (statusInterval !== undefined) window.clearInterval(statusInterval);
    reportStatus();
    statusInterval = window.setInterval(reportStatus, timing('statusIntervalMs', 10_000));
    observeResponses();
  }

  function queryFirst(selectors: string[] = []): Element | null {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function queryFirstVisible(selectors: string[] = []): Element | null {
    for (const selector of selectors) {
      const matches = document.querySelectorAll(selector);
      for (const match of matches) {
        if (isElementVisible(match)) return match;
      }
      // Lightweight test/fallback DOMs may implement querySelector without querySelectorAll.
      const first = document.querySelector(selector);
      if (first && isElementVisible(first)) return first;
    }
    return null;
  }

  function queryLastVisible(selectors: string[] = []): Element | null {
    const visible: Element[] = [];
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      const first = document.querySelector(selector);
      if (first && !matches.includes(first)) matches.push(first);
      for (const match of matches) {
        if (isElementVisible(match) && !visible.includes(match)) visible.push(match);
      }
    }
    let latest: Element | null = null;
    for (const candidate of visible) {
      if (!latest || elementFollows(latest, candidate) || !elementFollows(candidate, latest)) {
        latest = candidate;
      }
    }
    return latest;
  }

  function isElementVisible(element: Element): boolean {
    const html = element as HTMLElement;
    if (html.hidden || html.getAttribute?.('aria-hidden') === 'true') return false;
    try {
      const getComputedStyle = (window as Window & typeof globalThis).getComputedStyle;
      if (typeof getComputedStyle === 'function') {
        const style = getComputedStyle(element);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          (style.opacity !== '' && Number(style.opacity) === 0)
        ) {
          return false;
        }
      }
    } catch {
      // Treat an element as visible when a provider's custom element rejects style inspection.
    }
    try {
      const getClientRects = (element as HTMLElement).getClientRects;
      if (typeof getClientRects === 'function' && getClientRects.call(element).length === 0) return false;
    } catch {
      // A detached/custom element is handled by the provider's normal selector lifecycle.
    }
    return true;
  }

  function queryInput(activeAdapter: AdapterConfig): Element | null {
    if (activeAdapter.provider === 'grok') {
      return queryLastVisible([...GROK_LIVE_TEXTAREA_SELECTORS, ...activeAdapter.inputSelectors]);
    }
    return queryFirst(activeAdapter.inputSelectors);
  }

  function stop() {
    try {
      if (adapter && !abortAutomationForChallenge(adapter.provider, false, 'stop')) {
        const liveGrokButton =
          adapter.provider === 'grok' ? queryFirstVisible([GROK_LIVE_STOP_BUTTON_SELECTOR]) : null;
        const button = liveGrokButton ?? queryFirstVisible(adapter.stopButtonSelectors ?? []);
        (button as HTMLElement | null)?.click?.();
      }
    } catch {
      // best effort
    } finally {
      // The host already completed its waiter when it calls stop after a timeout. Release the
      // page-side generation too, or beginSendOperation() rejects every later Retry until reload.
      cancelResponseWait();
      activeSendOperation = undefined;
      draftStaging = false;
    }
  }

  function hasDetector(detectors: Detector[] = []): boolean {
    for (const detector of detectors) {
      const selector = typeof detector === 'string' ? detector : detector.selector;
      const matches = Array.from(document.querySelectorAll(selector));
      const first = document.querySelector(selector);
      if (first && !matches.includes(first)) matches.push(first);
      for (const element of matches) {
        if (!isElementVisible(element)) continue;
        if (typeof detector === 'string') return true;
        const text = element.textContent ?? '';
        if (detector.textIncludes && !text.includes(detector.textIncludes)) continue;
        if (detector.textExcludes && text.includes(detector.textExcludes)) continue;
        return true;
      }
    }
    return false;
  }

  function reportStatus() {
    if (!adapter) {
      bridge.emit({ v: 1, action: 'STATUS_REPORT', payload: { dom: 'unknown', bootId: bridge.bootId } });
      return;
    }
    let login: 'logged_in' | 'logged_out' | 'blocked' = 'logged_out';
    if (isProviderChallengeActive(adapter.provider)) {
      login = 'blocked';
    } else if (hasDetector(adapter.loggedOutDetectors)) {
      login = 'logged_out';
      // notes: gemini.json is the only adapter with an empty loggedOutDetectors, and this reads
      //        like an oversight -- Gemini's signed-out page renders the composer that
      //        loginDetectors look for, so a browser with no Google session still reports
      //        logged_in. It is deliberate. That page answers prompts, and login gates
      //        isSendable, so detecting the missing session would drop a provider that works
      //        from every fan-out. Tried and reverted on 2026-08-20. What it costs is a chip
      //        that says ready without saying "no account attached"; fixing that needs a state
      //        between logged_in and logged_out, not a detector.
    } else if (
      hasDetector(adapter.loginDetectors) ||
      (adapter.provider === 'grok' &&
        (queryInput(adapter) !== null || queryFirstVisible([GROK_LIVE_STOP_BUTTON_SELECTOR]) !== null))
    ) {
      login = 'logged_in';
    } else if (adapter.provider === 'gemini' && location.hostname === 'gemini.google.com') {
      login = 'blocked';
    }
    bridge.emit({
      v: 1,
      action: 'STATUS_REPORT',
      provider: adapter.provider,
      payload: { dom: 'ready', login, thinking: isGenerating(), bootId: bridge.bootId },
    });
  }

  function reportChallengeBlocked(provider: AIProvider) {
    bridge.emit({
      v: 1,
      action: 'STATUS_REPORT',
      provider,
      payload: { dom: 'ready', login: 'blocked', thinking: false, bootId: bridge.bootId },
    });
  }

  function abortAutomationForChallenge(
    providerHint: AIProvider | undefined,
    errorAsDone: boolean,
    operation: 'send' | 'fill' | 'stop',
    sendOperation?: number,
  ): boolean {
    const provider = providerHint ?? adapter?.provider;
    if (!provider || !isProviderChallengeActive(provider)) return false;
    reportChallengeBlocked(provider);
    logEngine(`${provider} ${operation} refused: security challenge is active`);
    if (errorAsDone) doneWithError(`${provider} security challenge is active`, provider, sendOperation);
    return true;
  }

  function beginSendOperation(providerHint?: AIProvider): number | undefined {
    if (activeSendOperation !== undefined || draftStaging || waitingForResponse) {
      logEngine(`${providerHint ?? adapter?.provider ?? 'provider'} send rejected: response in flight`);
      return undefined;
    }
    nextSendOperation += 1;
    activeSendOperation = nextSendOperation;
    return nextSendOperation;
  }

  function beginFillOperation(providerHint?: AIProvider): boolean {
    if (activeSendOperation !== undefined || draftStaging || waitingForResponse) {
      logEngine(`${providerHint ?? adapter?.provider ?? 'provider'} fill rejected: response in flight`);
      return false;
    }
    draftStaging = true;
    return true;
  }

  function releaseFillOperation() {
    void Promise.resolve().then(() => {
      draftStaging = false;
    });
  }

  function isActiveSendOperation(sendOperation: number): boolean {
    return activeSendOperation === sendOperation;
  }

  function releaseSendOperation(sendOperation: number) {
    void Promise.resolve().then(() => {
      if (activeSendOperation === sendOperation && !waitingForResponse) {
        activeSendOperation = undefined;
      }
    });
  }

  async function stageDraftForResponse(
    text: string,
    providerHint?: AIProvider,
    challengeErrorAsDone = true,
    sendOperation?: number,
    images: readonly string[] = [],
  ): Promise<{ activeAdapter: AdapterConfig; input: Element; injectionStartedAt: number } | undefined> {
    if (sendOperation !== undefined && !isActiveSendOperation(sendOperation)) return undefined;
    if (
      abortAutomationForChallenge(
        providerHint,
        challengeErrorAsDone,
        challengeErrorAsDone ? 'send' : 'fill',
        sendOperation,
      )
    ) {
      return undefined;
    }
    const activeAdapter = adapter;
    if (!activeAdapter) {
      doneWithError('adapter not installed', providerHint, sendOperation);
      return undefined;
    }
    const input = await retryLookup(() => queryInput(activeAdapter), {
      intervalMs: SELECTOR_RETRY_INTERVAL_MS,
      timeoutMs: INPUT_SELECTOR_TIMEOUT_MS,
    });
    if (sendOperation !== undefined && !isActiveSendOperation(sendOperation)) return undefined;
    if (!input) {
      doneWithError(`${activeAdapter.provider} input element not found`, activeAdapter.provider, sendOperation);
      return undefined;
    }
    if (
      abortAutomationForChallenge(
        activeAdapter.provider,
        challengeErrorAsDone,
        challengeErrorAsDone ? 'send' : 'fill',
        sendOperation,
      )
    ) {
      return undefined;
    }
    if (sendOperation !== undefined && rejectSendWhileProviderGenerating(activeAdapter.provider, sendOperation)) {
      return undefined;
    }

    armResponseWatch(activeAdapter, text);

    const injectionStartedAt = Date.now();
    const operation = challengeErrorAsDone ? 'send' : 'fill';
    const assertCanMutate = () => {
      if (sendOperation !== undefined && !isActiveSendOperation(sendOperation)) {
        throw new InactiveSendOperationError();
      }
      if (
        abortAutomationForChallenge(
          activeAdapter.provider,
          challengeErrorAsDone,
          operation,
          sendOperation,
        )
      ) {
        throw new ChallengeActiveError();
      }
    };
    try {
      assertCanMutate();
      await inputStrategies[activeAdapter.inputStrategy](input, text, assertCanMutate);
      assertCanMutate();
      assertInputLanded(input, text, activeAdapter.inputStrategy);
      // After the text, never before: the paste strategies select the whole editor before pasting,
      // which would take an inline image with it.
      await pasteImages(input, images, assertCanMutate);
    } catch (error) {
      if (error instanceof ChallengeActiveError) {
        if (!challengeErrorAsDone) cancelResponseWait();
        return undefined;
      }
      if (error instanceof InactiveSendOperationError) {
        return undefined;
      }
      doneWithError(
        `${activeAdapter.provider} input injection failed: ${errorMessage(error)}`,
        activeAdapter.provider,
        sendOperation,
      );
      return undefined;
    }

    return { activeAdapter, input, injectionStartedAt };
  }

  async function pasteImages(input: Element, images: readonly string[], assertCanMutate: ChallengeMutationGuard) {
    for (const dataUrl of images) {
      const file = fileFromDataUrl(dataUrl);
      if (!file) {
        logEngine('image paste skipped: not a base64 image data URL');
        continue;
      }
      assertCanMutate();
      tryFocus(input as HTMLElement, 'image paste');
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
      assertCanMutate();
      await sleep(IMAGE_PASTE_SETTLE_MS);
      assertCanMutate();
    }
  }

  async function sendMessage(
    text: string,
    providerHint: AIProvider | undefined,
    sendOperation: number,
    images: readonly string[] = [],
  ) {
    const staged = await stageDraftForResponse(text, providerHint, true, sendOperation, images);
    if (!staged) return;
    if (!isActiveSendOperation(sendOperation)) return;
    const { activeAdapter, input, injectionStartedAt } = staged;

    const preSendDelayMs = Math.max(0, PRE_SEND_DELAY_MS - (Date.now() - injectionStartedAt));
    window.setTimeout(() => {
      void (async () => {
        if (!isActiveSendOperation(sendOperation) || !waitingForResponse) return;
        if (abortAutomationForChallenge(activeAdapter.provider, true, 'send', sendOperation)) return;
        const firstAttempt = await activateSend(input, sendOperation, true);

        if (!isActiveSendOperation(sendOperation) || !waitingForResponse) return;
        window.setTimeout(() => {
          void retrySendIfStillPending(input, firstAttempt, activeAdapter, sendOperation);
        }, initialSendConfirmationDelay(activeAdapter));
      })();
    }, preSendDelayMs);
  }

  function queryResponses(activeAdapter: AdapterConfig): Element[] {
    return Array.from(document.querySelectorAll(activeAdapter.responseSelectors.join(', ')));
  }

  function armResponseWatch(activeAdapter: AdapterConfig, text: string, baseline?: Element[]) {
    const existingResponses = baseline ?? queryResponses(activeAdapter);
    lastSeenResponseEl = existingResponses.length > 0 ? existingResponses[existingResponses.length - 1] : null;
    responseBaselineEls = new Set(existingResponses);
    responseBaselineTextCounts = countResponseTextKeys(existingResponses);
    responseGeneration += 1;
    activeResponseGeneration = responseGeneration;
    waitingForResponse = true;
    lastResponseText = '';
    lastCompletionActivityAt = Date.now();
    pendingPromptText = text;
    injectionStageTrail = '';
    matchingChatGptUserTurnBaseline = countMatchingChatGptUserTurns(activeAdapter, text);
    activeChatGptUserTurnAnchor = null;
    lastActivatedInput = null;
    resetChatGptTerminalGate();
    startResponsePolling();
  }

  // A question typed straight into the provider's own composer never passes through SEND_MESSAGE
  // or FILL_DRAFT, so nothing arms the response watch and the app records neither the question nor
  // the answer. Watch the composer instead of the rendered user message: inputSelectors are the
  // one prompt-side anchor every adapter already keeps current, while the rendered user bubble has
  // no shared shape across providers. A composer that empties out is the same signal sendStarted()
  // already trusts to tell that a send landed.
  function watchNativeTurn() {
    if (!adapter || waitingForResponse || draftStaging || nativeAdoptPending || activeSendOperation !== undefined) return;
    const prompt = composerPromptText(queryFirst(adapter.inputSelectors));
    if (prompt) {
      nativeDraftText = prompt;
      // The response baseline has to predate the send. A composer that still holds a draft is the
      // proof of that: the provider renders the answer element together with the user's message,
      // so a baseline taken any later already contains it and getLatestResponseText() skips the
      // answer for the whole turn.
      nativeResponseBaseline = queryResponses(adapter);
      return;
    }
    const emptied = nativeDraftText;
    if (!emptied) return;
    nativeDraftText = '';
    nativeAdoptPending = true;
    void adoptNativeTurn(emptied).finally(() => {
      nativeAdoptPending = false;
    });
  }

  function composerPromptText(input: Element | null): string {
    if (!input) return '';
    if (input instanceof HTMLTextAreaElement) return input.value.trim();
    // Not getInputText: textContent runs the paragraphs of a rich composer together, and the
    // question is reported to the app as the user wrote it.
    return serializeResponseText(input).trim();
  }

  async function adoptNativeTurn(prompt: string) {
    const activeAdapter = adapter;
    if (!activeAdapter) return;
    // An emptied composer is not proof of a send: the user can also clear a draft by hand. Wait for
    // the provider to answer for it. A fresh answer element counts alongside the thinking
    // detectors, so a provider whose thinking markup drifted still gets its turn captured. That
    // confirmation compares against what is on screen now, so a hand-cleared draft cannot read as
    // a send; the response watch is armed with the pre-send baseline instead, because everything
    // rendered by the send itself -- the answer element included -- is already here.
    const preSendResponses = nativeResponseBaseline;
    const confirmEls = new Set(queryResponses(activeAdapter));
    const started = await retryLookup(
      () => (isThinking() || queryResponses(activeAdapter).some((el) => !confirmEls.has(el)) ? true : null),
      { intervalMs: NATIVE_TURN_POLL_MS, timeoutMs: NATIVE_TURN_CONFIRM_TIMEOUT_MS },
    );
    if (!started) return;
    if (adapter !== activeAdapter || waitingForResponse || draftStaging || activeSendOperation !== undefined) return;
    armResponseWatch(activeAdapter, prompt, preSendResponses);
    logEngine(`${activeAdapter.provider} adopted a native turn typed in the provider UI`);
    bridge.emit({ v: 1, action: 'NATIVE_PROMPT', provider: activeAdapter.provider, payload: prompt });
  }

  async function fillDraft(text: string, providerHint?: AIProvider) {
    const staged = await stageDraftForResponse(text, providerHint, false);
    if (!staged) return;
    logEngine(`${staged.activeAdapter.provider} fill: draft staged, awaiting native send`);
  }

  async function retrySendIfStillPending(
    originalInput: Element,
    firstAttempt: SendActivationResult,
    originalAdapter: AdapterConfig,
    sendOperation: number,
  ) {
    if (!isActiveSendOperation(sendOperation) || !waitingForResponse || !adapter) return;
    if (abortAutomationForChallenge(originalAdapter.provider, true, 'send', sendOperation)) return;
    if (sendStarted(adapter)) return;
    if (adapter.provider === 'chatgpt' && providerStillGeneratingBeforeSend(adapter.provider)) {
      logEngine('chatgpt retry suppressed: native generation became visible');
      return;
    }

    const currentInput = queryInput(adapter);
    if (!currentInput) {
      if (adapter.provider === 'chatgpt') {
        doneWithError(
          'chatgpt send could not be confirmed; composer disappeared before a matching user turn appeared',
          originalAdapter.provider,
          sendOperation,
        );
        return;
      }
      if (!firstAttempt.ok) {
        doneWithError(
          `${originalAdapter.provider} input disappeared before send was confirmed`,
          originalAdapter.provider,
          sendOperation,
        );
      }
      return;
    }
    const inputText = getInputText(currentInput).trim();
    if (!inputText) {
      if (adapter.provider === 'chatgpt') {
        doneWithError(
          'chatgpt send could not be confirmed; composer cleared before a matching user turn appeared',
          originalAdapter.provider,
          sendOperation,
        );
      }
      return;
    }

    if (adapter.provider === 'chatgpt' && !composerTextMatches(currentInput, pendingPromptText)) {
      // The empty case already returned above, so the composer always holds text here.
      const detail = composerMismatchDetail(currentInput, pendingPromptText);
      logEngine(`chatgpt send not confirmed; composer changed: ${detail}`);
      doneWithError(
        `chatgpt send could not be confirmed; composer changed before a matching user turn appeared (${detail})`,
        originalAdapter.provider,
        sendOperation,
      );
      return;
    }

    if (adapter.provider !== 'chatgpt' && firstAttempt.ok && firstAttempt.path === 'button-click') {
      const firstButton = querySendButton(adapter, currentInput);
      if (!firstButton || isDisabled(firstButton)) return;
    }

    const retryInput = currentInput ?? originalInput;
    const retryAttempt = await activateSend(retryInput, sendOperation, false);
    if (!isActiveSendOperation(sendOperation) || !waitingForResponse) return;

    if (!retryAttempt.ok) {
      doneWithError(
        `${originalAdapter.provider} send activation failed: ${retryAttempt.detail ?? firstAttempt.detail ?? retryAttempt.path}`,
        originalAdapter.provider,
        sendOperation,
      );
      return;
    }

    window.setTimeout(() => {
      void verifySendAfterRetry(retryAttempt, originalAdapter, sendOperation);
    }, fallbackSendConfirmationDelay(originalAdapter));
  }

  async function verifySendAfterRetry(
    retryAttempt: SendActivationResult,
    originalAdapter: AdapterConfig,
    sendOperation: number,
  ) {
    const activeAdapter = adapter;
    if (
      !isActiveSendOperation(sendOperation) ||
      !waitingForResponse ||
      !activeAdapter ||
      activeAdapter.provider !== originalAdapter.provider
    ) {
      return;
    }
    if (abortAutomationForChallenge(activeAdapter.provider, true, 'send', sendOperation)) return;
    if (sendStarted(activeAdapter)) return;
    if (activeAdapter.provider === 'chatgpt' && providerStillGeneratingBeforeSend(activeAdapter.provider)) {
      logEngine('chatgpt final send fallback suppressed: native generation is visible');
      return;
    }

    const currentInput = queryInput(activeAdapter);
    if (!currentInput) {
      if (activeAdapter.provider === 'chatgpt') {
        doneWithError(
          'chatgpt send could not be confirmed; composer disappeared before a matching user turn appeared',
          activeAdapter.provider,
          sendOperation,
        );
      }
      return;
    }

    if (activeAdapter.provider === 'chatgpt' && !composerTextMatches(currentInput, pendingPromptText)) {
      // A cleared composer is already fully described by the word "cleared". Only spend the
      // fingerprint on the case where text is present but differs.
      const changed = Boolean(getInputText(currentInput).trim());
      const detail = changed ? ` (${composerMismatchDetail(currentInput, pendingPromptText)})` : '';
      logEngine(`chatgpt send not confirmed after retry; composer ${changed ? 'changed' : 'cleared'}${detail}`);
      doneWithError(
        `chatgpt send could not be confirmed; composer ${changed ? 'changed' : 'cleared'} before a matching user turn appeared${detail}`,
        activeAdapter.provider,
        sendOperation,
      );
      return;
    }

    const sendButton = querySendButton(activeAdapter, currentInput);
    if (
      activeAdapter.provider !== 'chatgpt' &&
      retryAttempt.path === 'button-click' &&
      (!sendButton || isDisabled(sendButton))
    ) {
      return;
    }
    const hadSendButton = Boolean(sendButton);

    if (abortAutomationForChallenge(activeAdapter.provider, true, 'send', sendOperation)) return;
    const enterOk = dispatchEnter(currentInput);
    logEngine(`${activeAdapter.provider} final send fallback: enter-key${enterOk ? '' : ' failed'}`);
    if (!enterOk) {
      doneWithError(
        `${activeAdapter.provider} send activation failed: enter key dispatch failed`,
        activeAdapter.provider,
        sendOperation,
      );
      return;
    }

    window.setTimeout(() => {
      if (
        !isActiveSendOperation(sendOperation) ||
        !waitingForResponse ||
        !adapter ||
        adapter.provider !== originalAdapter.provider
      ) {
        return;
      }
      if (abortAutomationForChallenge(adapter.provider, true, 'send', sendOperation)) return;
      if (sendStarted(adapter)) return;
      const finalInput = queryInput(adapter);
      if (adapter.provider === 'chatgpt') {
        if (finalInput && composerTextMatches(finalInput, pendingPromptText)) {
          doneWithError(
            'chatgpt send was not accepted; draft is still in composer',
            adapter.provider,
            sendOperation,
          );
        } else {
          const changed = Boolean(finalInput && getInputText(finalInput).trim());
          const composerState = changed ? 'changed' : finalInput ? 'cleared' : 'disappeared';
          // Only "changed" carries a hidden difference worth fingerprinting.
          const detail =
            changed && finalInput ? ` (${composerMismatchDetail(finalInput, pendingPromptText)})` : '';
          logEngine(`chatgpt final send fallback not confirmed; composer ${composerState}${detail}`);
          doneWithError(
            `chatgpt send could not be confirmed; composer ${composerState} before a matching user turn appeared${detail}`,
            adapter.provider,
            sendOperation,
          );
        }
        return;
      }
      const finalButton = finalInput ? querySendButton(adapter, finalInput) : null;
      if (!finalInput || !getInputText(finalInput).trim()) return;
      if (hadSendButton && (!finalButton || isDisabled(finalButton))) return;
      doneWithError(
        `${adapter.provider} send was not accepted; draft is still in composer`,
        adapter.provider,
        sendOperation,
      );
    }, fallbackSendConfirmationDelay(originalAdapter));
  }

  async function activateSend(
    input: Element,
    sendOperation: number,
    allowComposerRestore: boolean,
  ): Promise<SendActivationResult> {
    if (!isActiveSendOperation(sendOperation)) {
      return { ok: false, path: 'enter-key', detail: 'send operation is no longer active' };
    }
    const activeAdapter = adapter;
    if (!activeAdapter) return { ok: false, path: 'enter-key', detail: 'adapter not installed' };
    if (abortAutomationForChallenge(activeAdapter.provider, true, 'send', sendOperation)) {
      return { ok: false, path: 'enter-key', detail: 'security challenge is active' };
    }
    let liveInput = await prepareLiveInputForSend(input, activeAdapter, sendOperation, allowComposerRestore);
    if (!allowComposerRestore && sendStarted(activeAdapter)) {
      return { ok: true, path: 'button-click', detail: 'send confirmed while preparing retry' };
    }
    if (!liveInput) {
      return { ok: false, path: 'enter-key', detail: 'live composer is unavailable' };
    }
    if (allowComposerRestore && rejectSendWhileProviderGenerating(activeAdapter.provider, sendOperation)) {
      return { ok: false, path: 'enter-key', detail: 'provider resumed generation before activation' };
    }
    if (activeAdapter.sendStrategy !== 'enter') {
      let sendBtn = await retryLookup(
        () => (liveInput ? querySendButton(activeAdapter, liveInput) : null),
        {
        intervalMs: SELECTOR_RETRY_INTERVAL_MS,
        timeoutMs: SEND_BUTTON_SELECTOR_TIMEOUT_MS,
        },
      );
      if (!isActiveSendOperation(sendOperation)) {
        return { ok: false, path: 'enter-key', detail: 'send operation is no longer active' };
      }
      if (abortAutomationForChallenge(activeAdapter.provider, true, 'send', sendOperation)) {
        return { ok: false, path: 'enter-key', detail: 'security challenge is active' };
      }
      if (!allowComposerRestore && sendStarted(activeAdapter)) {
        return { ok: true, path: 'button-click', detail: 'send confirmed during retry lookup' };
      }
      if (allowComposerRestore && rejectSendWhileProviderGenerating(activeAdapter.provider, sendOperation)) {
        return { ok: false, path: 'button-click', detail: 'provider resumed generation before activation' };
      }
      const revalidatedInput = await prepareLiveInputForSend(
        liveInput,
        activeAdapter,
        sendOperation,
        allowComposerRestore,
      );
      if (!revalidatedInput) {
        return { ok: false, path: 'button-click', detail: 'live composer changed before activation' };
      }
      if (revalidatedInput !== liveInput) {
        liveInput = revalidatedInput;
        sendBtn = querySendButton(activeAdapter, liveInput);
      }
      if (sendBtn) {
        if (isDisabled(sendBtn)) {
          logEngine(`${activeAdapter.provider} send path: send button disabled; falling back to enter`);
        } else {
          if (allowComposerRestore && rejectSendWhileProviderGenerating(activeAdapter.provider, sendOperation)) {
            return { ok: false, path: 'button-click', detail: 'provider resumed generation before activation' };
          }
          lastActivatedInput = liveInput;
          const clicked = clickElement(sendBtn, `${activeAdapter.provider} send button`);
          logEngine(`${activeAdapter.provider} send path: button-click${clicked ? '' : ' failed; falling back to enter'}`);
          if (clicked) return { ok: true, path: 'button-click' };
        }
      } else {
        logEngine(`${activeAdapter.provider} send path: send button not found; falling back to enter`);
      }
    }

    if (!isActiveSendOperation(sendOperation)) {
      return { ok: false, path: 'enter-key', detail: 'send operation is no longer active' };
    }
    if (abortAutomationForChallenge(activeAdapter.provider, true, 'send', sendOperation)) {
      return { ok: false, path: 'enter-key', detail: 'security challenge is active' };
    }
    if (!allowComposerRestore && sendStarted(activeAdapter)) {
      return { ok: true, path: 'enter-key', detail: 'send confirmed before retry fallback' };
    }
    const revalidatedInput = await prepareLiveInputForSend(
      liveInput,
      activeAdapter,
      sendOperation,
      allowComposerRestore,
    );
    if (!revalidatedInput) {
      return { ok: false, path: 'enter-key', detail: 'live composer changed before activation' };
    }
    liveInput = revalidatedInput;
    if (allowComposerRestore && rejectSendWhileProviderGenerating(activeAdapter.provider, sendOperation)) {
      return { ok: false, path: 'enter-key', detail: 'provider resumed generation before activation' };
    }
    lastActivatedInput = liveInput;
    const ok = dispatchEnter(liveInput);
    logEngine(`${activeAdapter.provider} send path: enter-key${ok ? '' : ' failed'}`);
    return { ok, path: 'enter-key', detail: ok ? undefined : 'enter key dispatch failed' };
  }

  async function prepareLiveInputForSend(
    stagedInput: Element,
    activeAdapter: AdapterConfig,
    sendOperation: number,
    allowComposerRestore: boolean,
  ): Promise<Element | null> {
    if (activeAdapter.provider !== 'chatgpt' && activeAdapter.provider !== 'grok') return stagedInput;
    const provider = activeAdapter.provider;
    const liveInput = await retryLookup(() => queryInput(activeAdapter), {
      intervalMs: SELECTOR_RETRY_INTERVAL_MS,
      timeoutMs: INPUT_SELECTOR_TIMEOUT_MS,
    });
    if (!isActiveSendOperation(sendOperation) || !waitingForResponse) return null;
    if (allowComposerRestore && rejectSendWhileProviderGenerating(activeAdapter.provider, sendOperation)) {
      return null;
    }
    if (!liveInput) {
      if (allowComposerRestore) {
        doneWithError(`${provider} input disappeared before send`, provider, sendOperation);
      }
      return null;
    }
    if (!allowComposerRestore && sendStarted(activeAdapter)) return liveInput;
    if (composerTextMatches(liveInput, pendingPromptText)) return liveInput;
    if (getInputText(liveInput).trim()) {
      const detail = composerMismatchDetail(liveInput, pendingPromptText);
      logEngine(`${provider} composer changed before send: ${detail}`);
      doneWithError(`${provider} composer changed before send (${detail})`, provider, sendOperation);
      return null;
    }
    if (!allowComposerRestore) return null;

    const assertCanMutate = () => {
      if (!isActiveSendOperation(sendOperation)) throw new InactiveSendOperationError();
      if (abortAutomationForChallenge(activeAdapter.provider, true, 'send', sendOperation)) {
        throw new ChallengeActiveError();
      }
    };
    try {
      assertCanMutate();
      await inputStrategies[activeAdapter.inputStrategy](liveInput, pendingPromptText, assertCanMutate);
      assertCanMutate();
      assertInputLanded(liveInput, pendingPromptText, activeAdapter.inputStrategy);
      logEngine(`${provider} send path: restored prompt into remounted composer`);
      return liveInput;
    } catch (error) {
      if (error instanceof ChallengeActiveError || error instanceof InactiveSendOperationError) return null;
      doneWithError(
        `${provider} live composer injection failed: ${errorMessage(error)}`,
        provider,
        sendOperation,
      );
      return null;
    }
  }

  function defaultInjectInput(input: Element, text: string, assertCanMutate: ChallengeMutationGuard) {
    const el = input as HTMLElement;
    assertCanMutate();
    tryFocus(el, 'default input');
    assertCanMutate();

    if (input instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(input, text);
      else input.value = text;
      assertCanMutate();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      assertCanMutate();
    } else {
      assertCanMutate();
      try {
        const sel = window.getSelection();
        if (!sel) throw new InputInjectionError('selection unavailable');
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (error) {
        logEngine(`default input selection guard fell back to execCommand: ${errorMessage(error)}`);
      }
      assertCanMutate();
      const inserted = execInsertText(text);
      assertCanMutate();
      if (!inserted) throw new InputInjectionError('execCommand insertText returned false');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      assertCanMutate();
    }
  }

  // A leftover draft is not something the paste below can replace. The synthetic paste and
  // execInsertText both write past ProseMirror's own document, so the editor reverts them from its
  // internal state and the prompt ends up appended to the stale text instead of replacing it.
  // Clearing by hand (Ctrl+A, Delete) does work, so send those keys and verify after a settle:
  // an editor that reads empty in the same tick can still refill from ProseMirror's document a
  // moment later.
  // notes: verified on the ChatGPT composer only. Grok shares this strategy but was never seen
  //        in this state, so there is no second technique here. The clear-keys stage in the
  //        injection error names the length left behind if another editor ignores the keys.
  async function clearProseMirrorComposer(editor: HTMLElement, assertCanMutate: ChallengeMutationGuard) {
    const composerLength = () => compactVisibleText(getInputText(editor)).length;
    if (!composerLength()) return;

    const key = (init: KeyboardEventInit) => {
      editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init }));
    };

    assertCanMutate();
    key({ key: 'a', code: 'KeyA', keyCode: 65, which: 65, ctrlKey: true });
    key({ key: 'Delete', code: 'Delete', keyCode: 46, which: 46 });
    await sleep(COMPOSER_SETTLE_MS);
    assertCanMutate();
    recordInjectionStage(`clear-keys:${composerLength()}`);
  }

  async function prosemirrorPasteInput(el: Element, text: string, assertCanMutate: ChallengeMutationGuard) {
    const editor = el as HTMLElement;
    recordInjectionStage(
      `want:${compactVisibleText(text).length} before:${compactVisibleText(getInputText(el)).length}`,
    );
    assertCanMutate();
    tryFocus(editor, 'prosemirror editor');
    assertCanMutate();

    // Grok currently serves both ProseMirror and native textarea composer cohorts. The adapter's
    // frozen seed still names the ProseMirror strategy, so route a live textarea through React's
    // native value setter instead of trying to paste/replace DOM children inside it.
    if (el instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      assertCanMutate();
      if (setter) setter.call(el, text);
      else el.value = text;
      assertCanMutate();
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      assertCanMutate();
      recordInjectionStage(`textarea:${compactVisibleText(getInputText(el)).length}`);
      return;
    }

    await clearProseMirrorComposer(editor, assertCanMutate);

    try {
      tryFocus(editor, 'prosemirror paste');
      assertCanMutate();
      const selection = window.getSelection();
      if (!selection) throw new InputInjectionError('selection unavailable');
      const range = document.createRange();
      range.selectNodeContents(editor);
      selection.removeAllRanges();
      selection.addRange(range);

      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      assertCanMutate();
      editor.dispatchEvent(pasteEvent);
      assertCanMutate();
      // ProseMirror applies the paste to its own document and renders it a tick or two later. A
      // microtask is not enough to see it: the composer still reads empty, the fallback below
      // concludes the paste was ignored, and its second insert lands on top of the first once both
      // flush -- the composer then holds the prompt twice and every send after it fails.
      await sleep(COMPOSER_SETTLE_MS);
      assertCanMutate();
      recordInjectionStage(`paste:${compactVisibleText(getInputText(editor)).length}`);
    } catch (error) {
      if (error instanceof ChallengeActiveError) throw error;
      recordInjectionStage('paste:threw');
      logEngine(`prosemirror synthetic paste failed: ${errorMessage(error)}`);
    }

    assertCanMutate();
    // The paste has settled by now, so a match here is the editor's own state rather than a DOM
    // write about to be reverted. Every fallback that runs on top of a good paste is what puts the
    // prompt in twice.
    if (!composerTextMatches(editor, text)) {
      try {
        tryFocus(editor, 'prosemirror insertText fallback');
        assertCanMutate();
        const selection = window.getSelection();
        if (!selection) throw new InputInjectionError('selection unavailable');
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges();
        selection.addRange(range);
        assertCanMutate();
        const inserted = execInsertText(text);
        assertCanMutate();
        if (inserted) {
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
          assertCanMutate();
          // Same settle as the paste above, for the same reason: judging this write in the same
          // tick is what makes the next fallback insert the prompt a second time.
          await sleep(COMPOSER_SETTLE_MS);
          assertCanMutate();
        }
        recordInjectionStage(`insertText:${compactVisibleText(getInputText(editor)).length}`);
      } catch (error) {
        if (error instanceof ChallengeActiveError) throw error;
        recordInjectionStage('insertText:threw');
        logEngine(`prosemirror insertText fallback failed: ${errorMessage(error)}`);
      }
    }

    assertCanMutate();
    if (!composerTextMatches(editor, text)) {
      assertCanMutate();
      editor.replaceChildren();
      const p = document.createElement('p');
      p.textContent = text;
      editor.appendChild(p);
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      assertCanMutate();
      recordInjectionStage(`replaceChildren:${compactVisibleText(getInputText(editor)).length}`);
    }

    // replaceChildren() above writes the DOM past ProseMirror's document, so the editor can read
    // as correct now and revert a moment later. Settle first, then let the caller's
    // assertInputLanded() judge what the composer actually holds. Without this the mismatch stays
    // hidden until send, where the draft is already ruined and the error cannot say why.
    await sleep(COMPOSER_SETTLE_MS);
    assertCanMutate();
    recordInjectionStage(`settled:${compactVisibleText(getInputText(editor)).length}`);
  }

  async function quillAngularInput(el: Element, text: string, assertCanMutate: ChallengeMutationGuard) {
    const editor = el as HTMLElement;
    assertCanMutate();
    tryFocus(editor, 'quill editor');
    assertCanMutate();
    // Trusted-Types-safe clear: Gemini enforces Trusted Types (CSP), under which ANY innerHTML
    // assignment — even '' — throws "requires 'TrustedHTML' assignment". replaceChildren() removes
    // all children with no HTML parsing, so it never trips Trusted Types.
    assertCanMutate();
    editor.replaceChildren();

    const lines = text.split('\n');
    const fragment = document.createDocumentFragment();
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line || '\u00A0';
      fragment.appendChild(p);
    }
    editor.appendChild(fragment);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    assertCanMutate();
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    assertCanMutate();

    await Promise.resolve();
    assertCanMutate();
    if (!editor.textContent?.trim()) {
      tryFocus(editor, 'quill fallback');
      assertCanMutate();
      const inserted = execInsertText(text);
      assertCanMutate();
      if (!inserted) throw new InputInjectionError('quill fallback execCommand insertText returned false');
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      assertCanMutate();
    }
  }

  function getLatestResponseText(): string | null {
    return getLatestResponseCandidate()?.text ?? null;
  }

  function getLatestResponseCandidate(): ResponseCandidate | null {
    if (!adapter) return null;
    const chatGptAnchor = adapter.provider === 'chatgpt' ? refreshChatGptUserTurnAnchor(adapter) : null;
    if (adapter.provider === 'chatgpt' && !chatGptAnchor) return null;
    const responseEls = Array.from(document.querySelectorAll(adapter.responseSelectors.join(', ')));
    if (responseEls.length === 0) return null;
    for (let index = responseEls.length - 1; index >= 0; index -= 1) {
      const response = responseEls[index];
      if (chatGptAnchor && !elementFollows(chatGptAnchor, response)) continue;
      if (!chatGptAnchor && waitingForResponse && responseBaselineEls.has(response)) continue;
      if (isUserMessageElement(response)) continue;
      const text = extractResponseText(response);
      if (!chatGptAnchor && waitingForResponse && text && !responseTextIsBeyondBaseline(text, responseEls)) continue;
      if (text && !isLikelyPromptEcho(text, pendingPromptText)) return { element: response, text };
    }
    return null;
  }

  // An empty capture looks exactly like a provider that answered nothing, and the facts that decide
  // it -- which filter dropped every candidate -- live only in this frame. Name them in the error so
  // the event log and the run snapshot carry the diagnosis instead of a blank answer.
  function describeEmptyCapture(): string {
    if (!adapter) return 'no adapter';
    const parts = [`cached:${lastResponseText.length}`];
    const chatGptAnchor = adapter.provider === 'chatgpt' ? refreshChatGptUserTurnAnchor(adapter) : null;
    if (adapter.provider === 'chatgpt') {
      parts.push(`anchor:${chatGptAnchor ? 'found' : 'missing'}`);
      if (!chatGptAnchor) {
        // A missing anchor has two very different causes: the page shows no user turn for this send
        // at all, or it shows turns whose text no longer matches the prompt we sent. Only the counts
        // tell them apart.
        const turns = Array.from(document.querySelectorAll(CHATGPT_USER_MESSAGE_SELECTOR));
        parts.push(
          `turns:${turns.length}`,
          `matching:${matchingChatGptUserTurns(adapter, pendingPromptText).length}`,
          `turnBaseline:${matchingChatGptUserTurnBaseline}`,
          `prompt:${pendingPromptText.length}`,
        );
        // Turns on the page that none of the comparisons accepted. Where each one parts company
        // with the prompt says whether the page shortened the message or rewrote it.
        const wanted = compactVisibleText(pendingPromptText);
        turns.slice(-2).forEach((turn, index) => {
          parts.push(`turn${index}:[${textDivergence(compactVisibleText(turn.textContent ?? ''), wanted, 'turn')}]`);
        });
        return parts.join(', ');
      }
    }
    const responseEls = Array.from(document.querySelectorAll(adapter.responseSelectors.join(', ')));
    parts.push(`nodes:${responseEls.length}`);
    const rejected = new Map<string, number>();
    const count = (reason: string) => rejected.set(reason, (rejected.get(reason) ?? 0) + 1);
    for (let index = responseEls.length - 1; index >= 0; index -= 1) {
      const response = responseEls[index];
      if (chatGptAnchor && !elementFollows(chatGptAnchor, response)) {
        count('before-anchor');
        continue;
      }
      if (!chatGptAnchor && waitingForResponse && responseBaselineEls.has(response)) {
        count('baseline-element');
        continue;
      }
      if (isUserMessageElement(response)) {
        count('user-message');
        continue;
      }
      const text = extractResponseText(response);
      if (!text) {
        count('no-text');
        continue;
      }
      if (!chatGptAnchor && waitingForResponse && !responseTextIsBeyondBaseline(text, responseEls)) {
        count('at-baseline');
        continue;
      }
      // A candidate the real read rejected moments ago means the DOM moved between the two reads.
      count(isLikelyPromptEcho(text, pendingPromptText) ? 'prompt-echo' : 'would-match');
    }
    const tally = [...rejected].map(([reason, total]) => `${reason}:${total}`).join(' ');
    return parts.concat(tally || 'nothing scanned').join(', ');
  }

  function isUserMessageElement(response: Element): boolean {
    const closest = (response as Element & { closest?: (selector: string) => Element | null }).closest;
    if (typeof closest !== 'function') return false;
    try {
      return Boolean(closest.call(response, USER_MESSAGE_ANCESTOR_SELECTOR));
    } catch {
      return false;
    }
  }

  function extractResponseText(response: Element): string | null {
    const text = serializeResponseText(response);
    if (text) return text;
    const responseTag = typeof response.tagName === 'string' ? response.tagName.toUpperCase() : '';
    const asset = ['IMG', 'CANVAS', 'VIDEO'].includes(responseTag)
      ? response
      : response.querySelector?.('img, canvas, video') ?? null;
    if (!asset) return null;
    const alt = asset instanceof HTMLImageElement ? asset.alt.trim() : '';
    return alt ? `[Image generated: ${alt}]` : '[Image generated]';
  }

  function loadedGeneratedMedia(response: Element): Element | null {
    const responseTag = typeof response.tagName === 'string' ? response.tagName.toUpperCase() : '';
    const candidates: Element[] = ['IMG', 'CANVAS', 'VIDEO'].includes(responseTag) ? [response] : [];
    for (const media of Array.from(response.querySelectorAll?.('img, canvas, video') ?? [])) {
      if (!candidates.includes(media)) candidates.push(media);
    }
    const first = response.querySelector?.('img, canvas, video') ?? null;
    if (first && !candidates.includes(first)) candidates.push(first);
    return candidates.find((media) => isElementVisible(media) && generatedMediaIsLoaded(media)) ?? null;
  }

  function generatedMediaIsLoaded(media: Element): boolean {
    const tag = typeof media.tagName === 'string' ? media.tagName.toUpperCase() : '';
    if (tag === 'IMG') {
      const image = media as HTMLImageElement;
      return image.complete && image.naturalWidth > 0;
    }
    if (tag === 'CANVAS') {
      const canvas = media as HTMLCanvasElement;
      return canvas.width > 0 && canvas.height > 0;
    }
    if (tag === 'VIDEO') {
      return (media as HTMLVideoElement).readyState >= 1;
    }
    return false;
  }

  function chatGptCompletionEvidence(turn: Element, response: ResponseCandidate): Element | null {
    const signal = TURN_COMPLETION_SIGNALS.chatgpt;
    const copyMarker = signal ? queryFirstVisibleWithin(turn, [signal.complete]) : null;
    if (copyMarker) return copyMarker;
    return response.text.startsWith('[Image generated') ? loadedGeneratedMedia(response.element) : null;
  }

  function queryFirstVisibleWithin(root: Element, selectors: string[]): Element | null {
    for (const selector of selectors) {
      const matches = Array.from(root.querySelectorAll(selector));
      const first = root.querySelector(selector);
      if (first && !matches.includes(first)) matches.push(first);
      for (const match of matches) {
        if (isElementVisible(match)) return match;
      }
    }
    return null;
  }

  function currentChatGptCompletionTurn(responseElement?: Element): Element | null {
    if (!adapter || adapter.provider !== 'chatgpt') return null;
    const signal = TURN_COMPLETION_SIGNALS.chatgpt;
    if (!signal) return null;
    const anchor = refreshChatGptUserTurnAnchor(adapter);
    if (!anchor) return null;
    const response = responseElement ?? getLatestResponseCandidate()?.element;
    if (!response) return null;
    const eligibleTurns = Array.from(document.querySelectorAll(signal.turn)).filter((turn) =>
      elementFollows(anchor, turn) && elementContains(turn, response),
    );
    return eligibleTurns.length > 0 ? eligibleTurns[eligibleTurns.length - 1] : null;
  }

  function elementContains(container: Element, candidate: Element): boolean {
    if (container === candidate) return true;
    const contains = (container as Element & { contains?: (node: Node | null) => boolean }).contains;
    if (typeof contains === 'function') {
      try {
        return contains.call(container, candidate);
      } catch {
        return false;
      }
    }
    const closest = (candidate as Element & { closest?: (selector: string) => Element | null }).closest;
    if (typeof closest !== 'function') return false;
    try {
      return closest.call(candidate, TURN_COMPLETION_SIGNALS.chatgpt?.turn ?? '') === container;
    } catch {
      return false;
    }
  }

  function latestChatGptTurn(): Element | null {
    const signal = TURN_COMPLETION_SIGNALS.chatgpt;
    if (!signal) return null;
    const turns = Array.from(document.querySelectorAll(signal.turn));
    if (adapter?.provider === 'chatgpt') {
      const responses = Array.from(document.querySelectorAll(adapter.responseSelectors.join(', ')));
      const latestResponse = responses.length > 0 ? responses[responses.length - 1] : null;
      if (latestResponse) {
        for (let index = turns.length - 1; index >= 0; index -= 1) {
          const turn = turns[index];
          if (turn && elementContains(turn, latestResponse)) return turn;
        }
      }
    }
    return turns.length > 0 ? turns[turns.length - 1] : null;
  }

  function chatGptHasStrongActivity(turn?: Element | null): boolean {
    const activeTurn = turn ?? latestChatGptTurn();
    if (queryFirstVisible(CHATGPT_STRONG_STOP_SELECTORS)) return true;
    if (activeTurn && queryFirstVisibleWithin(activeTurn, CHATGPT_STRONG_ACTIVITY_SELECTORS)) return true;
    if (activeTurn && chatGptTurnHasActiveProgress(activeTurn)) return true;
    if (chatGptHasStrongExternalSidecarActivity(activeTurn)) return true;
    return chatGptHasActiveStatusLabel(activeTurn);
  }

  function chatGptHasStrongExternalSidecarActivity(turn?: Element | null): boolean {
    for (const selector of CHATGPT_VERIFIED_SIDECAR_SELECTORS) {
      const matches = Array.from(document.querySelectorAll(selector));
      const first = document.querySelector(selector);
      if (first && !matches.includes(first)) matches.push(first);
      for (const sidecar of matches) {
        if (
          !isElementVisible(sidecar) ||
          !chatGptExternalStatusBelongsToConversation(sidecar, turn)
        ) {
          continue;
        }
        if (elementHasStrongActivitySignal(sidecar)) return true;
        if (queryFirstVisibleWithin(sidecar, CHATGPT_STRONG_ACTIVITY_SELECTORS)) return true;
        if (chatGptTurnHasActiveProgress(sidecar)) return true;
      }
    }
    return false;
  }

  function elementHasStrongActivitySignal(element: Element): boolean {
    if (
      element.getAttribute('aria-busy') === 'true' ||
      element.getAttribute('data-streaming') === 'true' ||
      element.getAttribute('data-is-streaming') === 'true'
    ) {
      return true;
    }
    return (element.getAttribute('class') ?? '').split(/\s+/).some((name) => name.includes('loading-shimmer'));
  }

  function chatGptTurnHasActiveProgress(turn: Element): boolean {
    for (const selector of CHATGPT_PROGRESS_SELECTORS) {
      const matches = Array.from(turn.querySelectorAll(selector));
      const first = turn.querySelector(selector);
      if (first && !matches.includes(first)) matches.push(first);
      for (const element of matches) {
        if (isElementVisible(element) && progressIsActive(element)) return true;
      }
    }
    return false;
  }

  function progressIsActive(element: Element): boolean {
    const progress = element as Element & { value?: number; max?: number };
    const value = numericAttributeOrProperty(element, 'aria-valuenow', 'value', progress.value);
    const explicitMax = numericAttributeOrProperty(element, 'aria-valuemax', 'max', progress.max);
    const max = explicitMax ?? (element.getAttribute('role') === 'progressbar' ? 100 : null);
    return value === null || max === null || max <= 0 || value < max;
  }

  function numericAttributeOrProperty(
    element: Element,
    ariaName: string,
    attributeName: string,
    propertyValue: number | undefined,
  ): number | null {
    for (const raw of [element.getAttribute(ariaName), element.getAttribute(attributeName), propertyValue]) {
      if (raw === null || raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function chatGptHasActiveStatusLabel(turn?: Element | null): boolean {
    if (turn && rootHasActiveStatusLabel(turn, CHATGPT_TURN_STATUS_SELECTORS, CHATGPT_ACTIVE_STATUS_LABELS)) {
      return true;
    }
    const belongsToConversation = (element: Element) => chatGptExternalStatusBelongsToConversation(element, turn);
    return (
      rootHasActiveStatusLabel(
        document,
        [...CHATGPT_EXTERNAL_STATUS_SELECTORS, ...CHATGPT_VERIFIED_SIDECAR_SELECTORS],
        CHATGPT_ACTIVE_STATUS_LABELS,
        belongsToConversation,
      ) ||
      rootHasActiveStatusLabel(
        document,
        CHATGPT_EXTERNAL_LIVE_REGION_SELECTORS,
        CHATGPT_EXTERNAL_ACTIVE_STATUS_LABELS,
        belongsToConversation,
      )
    );
  }

  function rootHasActiveStatusLabel(
    root: Document | Element,
    selectors: string[],
    activeLabels: string[],
    acceptElement: (element: Element) => boolean = () => true,
  ): boolean {
    for (const selector of selectors) {
      const matches = Array.from(root.querySelectorAll(selector));
      const first = root.querySelector(selector);
      if (first && !matches.includes(first)) matches.push(first);
      for (const element of matches) {
        if (!isElementVisible(element) || !acceptElement(element)) continue;
        const labels = [element.textContent ?? '', element.getAttribute('aria-label') ?? '']
          .map(normalizeActivityLabel)
          .filter((label) => label.length > 0 && label.length <= 80);
        if (labels.some(chatGptStatusLabelIsCompleted)) continue;
        if (
          labels.some((label) =>
            activeLabels.some((active) => label === active || label.startsWith(`${active} `)),
          )
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function chatGptExternalStatusBelongsToConversation(element: Element, turn?: Element | null): boolean {
    if (turn && elementContains(turn, element)) return true;
    const userTurns = Array.from(document.querySelectorAll(CHATGPT_USER_MESSAGE_SELECTOR));
    const anchor = activeChatGptUserTurnAnchor ?? userTurns[userTurns.length - 1] ?? null;
    return Boolean(anchor && elementFollows(anchor, element));
  }

  function chatGptStatusLabelIsCompleted(label: string): boolean {
    return /^(?:(?:reasoning|(?:pro )?thinking)\s*(?:[·•:—–-]\s*)?)?thought\s+for\s+\d+(?:\.\d+)?\s*(?:ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)(?:\s+\d+(?:\.\d+)?\s*(?:ms|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?))*\s*(?:[·•:—–-]\s*)?(?:edit)?$/.test(
      label,
    );
  }

  function normalizeActivityLabel(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.…]+$/g, '')
      .trim();
  }

  function providerStillGeneratingBeforeSend(providerHint?: AIProvider): boolean {
    if (!adapter || adapter.provider !== 'chatgpt') return false;
    if (providerHint && providerHint !== adapter.provider) return false;
    return chatGptHasStrongActivity();
  }

  function rejectSendWhileProviderGenerating(providerHint: AIProvider | undefined, sendOperation: number): boolean {
    if (!providerStillGeneratingBeforeSend(providerHint)) return false;
    const provider = providerHint ?? adapter?.provider;
    if (!provider) return false;
    doneWithError(`${provider} send rejected: provider is still generating`, provider, sendOperation);
    return true;
  }

  function emptyChatGptTerminalGate(): ChatGptTerminalGateState {
    return { turn: null, response: null, completion: null, responseText: '', stableSince: 0, samples: 0 };
  }

  function resetChatGptTerminalGate() {
    chatGptTerminalGate = emptyChatGptTerminalGate();
  }

  function sampleChatGptTerminalGate(): boolean {
    const response = getLatestResponseCandidate();
    const turn = currentChatGptCompletionTurn(response?.element);
    const responseText = response?.text ?? null;
    const strongActivity = chatGptHasStrongActivity(turn);
    const completion = turn && response ? chatGptCompletionEvidence(turn, response) : null;
    if (!turn || !responseText || isThinking() || strongActivity || !completion) {
      if (strongActivity) lastCompletionActivityAt = Date.now();
      resetChatGptTerminalGate();
      return false;
    }

    const now = Date.now();
    if (
      chatGptTerminalGate.turn !== turn ||
      chatGptTerminalGate.response !== response?.element ||
      chatGptTerminalGate.completion !== completion ||
      chatGptTerminalGate.responseText !== responseText
    ) {
      chatGptTerminalGate = {
        turn,
        response: response?.element ?? null,
        completion,
        responseText,
        stableSince: now,
        samples: 1,
      };
      return false;
    }

    chatGptTerminalGate.samples += 1;
    return (
      chatGptTerminalGate.samples >= CHATGPT_TERMINAL_MIN_SAMPLES &&
      now - chatGptTerminalGate.stableSince >= CHATGPT_TERMINAL_MIN_STABLE_MS
    );
  }

  function isThinking(): boolean {
    if (hasDetector(adapter?.thinkingDetectors)) return true;
    return adapter?.provider === 'grok' && queryFirstVisible([GROK_LIVE_STOP_BUTTON_SELECTOR]) !== null;
  }

  // Response completion asks this instead of isThinking(). The split is deliberate: sendStarted()
  // uses isThinking() to decide whether a send landed, and right after a send the last turn is the
  // user message, which carries no copy button. Letting the turn signal reach sendStarted() would
  // make a failed send look accepted and leave the step waiting on a response that never comes.
  function isGenerating(): boolean {
    return (
      isThinking() ||
      (adapter?.provider === 'chatgpt' && chatGptHasStrongActivity(currentChatGptCompletionTurn())) ||
      lastTurnIncomplete()
    );
  }

  function lastTurnIncomplete(): boolean {
    if (!waitingForResponse || !adapter || !lastResponseText) return false;
    const signal = TURN_COMPLETION_SIGNALS[adapter.provider];
    if (!signal) return false;
    // The evidence below reads ChatGPT's turn markup: currentChatGptCompletionTurn() and
    // chatGptCompletionEvidence() both query TURN_COMPLETION_SIGNALS.chatgpt, not signal. Grok's
    // entry above needs the plain last-turn test it was written against -- routing it through the
    // ChatGPT path finds no turn, reports "still generating" forever, and no answer ever completes.
    if (adapter.provider !== 'chatgpt') {
      const turns = Array.from(document.querySelectorAll(signal.turn));
      const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
      if (!lastTurn || typeof lastTurn.querySelector !== 'function') return false;
      return !lastTurn.querySelector(signal.complete);
    }
    const response = getLatestResponseCandidate();
    const turn = currentChatGptCompletionTurn(response?.element);
    if (!turn) return true;
    return !response || chatGptCompletionEvidence(turn, response) === null;
  }

  function failIfTurnCompletionTimedOut(expectedGeneration: number): boolean {
    const thinking = isThinking();
    const completionTurn = currentChatGptCompletionTurn();
    const strongTurnActivity = chatGptHasStrongActivity(completionTurn);
    if (thinking || strongTurnActivity) {
      lastCompletionActivityAt = Date.now();
    }
    if (
      !waitingForResponse ||
      expectedGeneration !== activeResponseGeneration ||
      !adapter ||
      !TURN_COMPLETION_SIGNALS[adapter.provider] ||
      !lastResponseText ||
      thinking ||
      strongTurnActivity ||
      Date.now() - lastCompletionActivityAt < TURN_COMPLETION_CONFIRM_TIMEOUT_MS
    ) {
      return false;
    }
    const activeProvider = adapter?.provider;
    if (!activeProvider) return false;
    clearCheckDone();
    doneWithError(`${activeProvider} response completion could not be confirmed`, activeProvider, activeSendOperation);
    return true;
  }

  function checkIfDone(expectedGeneration = activeResponseGeneration) {
    if (!waitingForResponse || expectedGeneration !== activeResponseGeneration) return;
    if (failIfTurnCompletionTimedOut(expectedGeneration)) return;
    if (isGenerating()) {
      resetChatGptTerminalGate();
      if (checkDoneInterval === undefined) {
        checkDoneInterval = window.setInterval(() => {
          if (!waitingForResponse || expectedGeneration !== activeResponseGeneration) {
            clearCheckDone();
            return;
          }
          if (failIfTurnCompletionTimedOut(expectedGeneration)) return;
          if (!isGenerating()) {
            clearCheckDone();
            if (adapter?.provider === 'chatgpt') {
              checkIfDone(expectedGeneration);
              return;
            }
            finishResponseTimeout = window.setTimeout(() => {
              finishResponseTimeout = undefined;
              if (!waitingForResponse || expectedGeneration !== activeResponseGeneration) return;
              if (failIfTurnCompletionTimedOut(expectedGeneration)) return;
              if (isGenerating()) {
                checkIfDone(expectedGeneration);
                return;
              }
              finishResponse(expectedGeneration);
            }, timing('doneDelayMs', 3000));
          }
        }, 1000);
      }
      return;
    }
    if (adapter?.provider === 'chatgpt') {
      clearCheckDone();
      if (sampleChatGptTerminalGate()) {
        finishResponse(expectedGeneration);
        return;
      }
      clearFinishResponseTimeout();
      finishResponseTimeout = window.setTimeout(() => {
        finishResponseTimeout = undefined;
        checkIfDone(expectedGeneration);
      }, CHATGPT_TERMINAL_SAMPLE_INTERVAL_MS);
      return;
    }
    finishResponse(expectedGeneration);
  }

  function finishResponse(expectedGeneration = activeResponseGeneration) {
    if (!waitingForResponse || expectedGeneration !== activeResponseGeneration || !adapter) return;
    // Must re-read before cancelResponseWait(): getLatestResponseText filters the send-time
    // baseline through waitingForResponse and responseBaselineEls, so after the reset it would
    // return a message that already existed before the send.
    const payload = finalResponseText(lastResponseText, getLatestResponseText());
    const sendOperation = activeSendOperation;
    if (!payload.trim()) {
      // Report the empty capture before cancelResponseWait() clears the baselines the description
      // reads. The host rejects an empty answer either way; this is what says why it was empty.
      doneWithError(`${adapter.provider} captured an empty response (${describeEmptyCapture()})`, adapter.provider, sendOperation);
      return;
    }
    cancelResponseWait();
    bridge.emit({ v: 1, action: 'RESPONSE_DONE', provider: adapter.provider, payload });
    if (sendOperation !== undefined) releaseSendOperation(sendOperation);
  }

  function cancelResponseWait() {
    waitingForResponse = false;
    // The composer was watched before this turn, not during it. Drop what it held so the empty
    // composer this turn leaves behind cannot read as a second, native send.
    nativeDraftText = '';
    nativeResponseBaseline = [];
    clearTimersForResponse();
    responseBaselineEls.clear();
    responseBaselineTextCounts.clear();
    pendingPromptText = '';
    matchingChatGptUserTurnBaseline = 0;
    activeChatGptUserTurnAnchor = null;
    lastActivatedInput = null;
    resetChatGptTerminalGate();
  }

  function doneWithError(reason: string, providerHint?: AIProvider, sendOperation?: number) {
    if (sendOperation !== undefined && !isActiveSendOperation(sendOperation)) return;
    const provider = providerHint ?? adapter?.provider;
    if (!provider) {
      if (sendOperation !== undefined) releaseSendOperation(sendOperation);
      return;
    }
    cancelResponseWait();
    bridge.emit({ v: 1, action: 'RESPONSE_DONE', provider, payload: `[Error: ${reason}]` });
    if (sendOperation !== undefined) releaseSendOperation(sendOperation);
  }

  let observerInstalled = false;
  function observeResponses() {
    if (observerInstalled) return;
    if (!document.body) {
      const install = () => {
        document.removeEventListener('DOMContentLoaded', install);
        observeResponses();
      };
      document.addEventListener('DOMContentLoaded', install, { once: true });
      return;
    }
    const observer = new MutationObserver(() => {
      watchNativeTurn();
      if (!waitingForResponse) return;
      if (isThinking()) return;
      const currentText = getLatestResponseText();
      if (!currentText || currentText === lastResponseText) return;
      clearFinishResponseTimeout();
      lastResponseText = currentText;
      lastCompletionActivityAt = Date.now();
      resetChatGptTerminalGate();

      const now = Date.now();
      if (now - lastChunkTime >= timing('chunkDebounceMs', 500)) {
        lastChunkTime = now;
        if (adapter) bridge.emit({ v: 1, action: 'RESPONSE_CHUNK', provider: adapter.provider, payload: currentText });
      }
      if (responseTimeout !== undefined) window.clearTimeout(responseTimeout);
      const expectedGeneration = activeResponseGeneration;
      responseTimeout = window.setTimeout(
        () => checkIfDone(expectedGeneration),
        timing('doneDelayMs', 3000),
      );
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('input', watchNativeTurn, true);
    observerInstalled = true;
  }

  function startResponsePolling() {
    if (pollInterval !== undefined) return;
    pollInterval = window.setInterval(() => {
      if (!waitingForResponse) {
        if (pollInterval !== undefined) window.clearInterval(pollInterval);
        pollInterval = undefined;
        return;
      }
      const currentText = getLatestResponseText();
      if (!currentText || currentText === lastResponseText) {
        // A watch that never sees one line of text has no other way out: checkIfDone only ever runs
        // after the first chunk, so the wait would stay armed for the life of the page and every
        // later send on this provider would be refused as "response in flight". Same inactivity
        // window as the completion check, and thinking keeps it alive.
        if (
          !lastResponseText &&
          !isThinking() &&
          Date.now() - lastCompletionActivityAt > TURN_COMPLETION_CONFIRM_TIMEOUT_MS
        ) {
          doneWithError(`${adapter?.provider ?? 'provider'} produced no response text`, undefined, activeSendOperation);
        }
        return;
      }
      clearFinishResponseTimeout();
      lastResponseText = currentText;
      lastCompletionActivityAt = Date.now();
      resetChatGptTerminalGate();
      if (adapter) bridge.emit({ v: 1, action: 'RESPONSE_CHUNK', provider: adapter.provider, payload: currentText });
      if (responseTimeout !== undefined) window.clearTimeout(responseTimeout);
      const expectedGeneration = activeResponseGeneration;
      responseTimeout = window.setTimeout(
        () => checkIfDone(expectedGeneration),
        timing('doneDelayMs', 3000),
      );
    }, timing('backupPollMs', 3000));
  }

  function clearCheckDone() {
    if (checkDoneInterval !== undefined) window.clearInterval(checkDoneInterval);
    checkDoneInterval = undefined;
  }

  function clearFinishResponseTimeout() {
    if (finishResponseTimeout !== undefined) window.clearTimeout(finishResponseTimeout);
    finishResponseTimeout = undefined;
  }

  function clearTimersForResponse() {
    if (responseTimeout !== undefined) window.clearTimeout(responseTimeout);
    clearFinishResponseTimeout();
    if (pollInterval !== undefined) window.clearInterval(pollInterval);
    clearCheckDone();
    responseTimeout = undefined;
    pollInterval = undefined;
  }

  function timing(key: keyof NonNullable<AdapterConfig['timing']>, fallback: number): number {
    return adapter?.timing?.[key] ?? fallback;
  }

  function getInputText(input: Element | null): string {
    if (!input) return '';
    if (input instanceof HTMLTextAreaElement) return input.value;
    return input.textContent ?? '';
  }

  function assertInputLanded(input: Element, text: string, strategy: InputStrategyName) {
    if (!text.trim()) return;
    if (composerTextMatches(input, text)) return;
    if (!getInputText(input).trim()) {
      // Strategies that record no stages say nothing useful here, so leave the suffix off.
      const stages = injectionStageTrail ? ` (stages ${injectionStageTrail})` : '';
      throw new InputInjectionError(`${strategy} left editor empty after injection${stages}`);
    }
    throw new InputInjectionError(
      `${strategy} produced mismatched editor text after injection (${composerMismatchDetail(input, text)})`,
    );
  }

  function composerTextMatches(input: Element, expected: string): boolean {
    return compactVisibleText(getInputText(input)) === compactVisibleText(expected);
  }

  function compactVisibleText(value: string): string {
    return value.normalize('NFKC').replace(/\s+/g, '');
  }

  // Which injection stages ran, and the composer length each one left behind. The DOM is not a
  // reliable witness of a ProseMirror document: the last-resort replaceChildren() writes past the
  // editor's own model, so the text can read as correct at injection time and change back later.
  // The trail is what tells a stage apart from the one after it. Reset per send by armResponseWatch.
  function recordInjectionStage(stage: string) {
    injectionStageTrail = injectionStageTrail ? `${injectionStageTrail} > ${stage}` : stage;
  }

  // A bare "composer changed before send" tells a bug reporter nothing: the prompt is still
  // visible in the composer, so the mismatch is in characters nobody can see. Report where the
  // two strings part company so one screenshot is enough to tell truncation from rewriting.
  function composerMismatchDetail(input: Element, expected: string): string {
    const detail = textDivergence(compactVisibleText(getInputText(input)), compactVisibleText(expected), 'composer');
    return `${detail}; stages ${injectionStageTrail || 'none'}`;
  }

  // Where two strings part company, in the compacted form the comparisons use. One line is enough
  // to tell truncation from rewriting, for a composer draft and for a rendered user turn alike.
  function textDivergence(actual: string, wanted: string, subject: string): string {
    let i = 0;
    while (i < actual.length && i < wanted.length && actual[i] === wanted[i]) i += 1;
    const shape = wanted.startsWith(actual)
      ? 'truncated'
      : actual.startsWith(wanted)
        ? 'extended'
        : 'diverged';
    return (
      `${shape} at ${i}/${wanted.length}, ${subject} has ${actual.length}; ` +
      `expected ${JSON.stringify(wanted.slice(i, i + 24))}, got ${JSON.stringify(actual.slice(i, i + 24))}`
    );
  }

  function countMatchingChatGptUserTurns(activeAdapter: AdapterConfig, prompt: string): number {
    return matchingChatGptUserTurns(activeAdapter, prompt).length;
  }

  function matchingChatGptUserTurns(activeAdapter: AdapterConfig, prompt: string): Element[] {
    if (activeAdapter.provider !== 'chatgpt' || !prompt.trim()) return [];
    const expected = compactVisibleText(prompt);
    const visibleExpected = promptEchoComparisonKey(prompt);
    return Array.from(document.querySelectorAll(CHATGPT_USER_MESSAGE_SELECTOR)).filter(
      (turn) => {
        // The turn element carries its own controls, so its text is the prompt plus chrome: a long
        // message renders with "顯示更多"/"顯示較少" and a reaction button inside the same element.
        // Equality rejected every one of those turns, the anchor stayed missing, and the whole turn
        // captured nothing. The prefix is the part the page echoed back.
        const content = turn.textContent ?? '';
        return (
          compactVisibleText(content).startsWith(expected) ||
          (visibleExpected !== '' && promptEchoComparisonKey(content).startsWith(visibleExpected))
        );
      },
    );
  }

  function refreshChatGptUserTurnAnchor(activeAdapter: AdapterConfig): Element | null {
    if (activeAdapter.provider !== 'chatgpt') return null;
    const matchingTurns = matchingChatGptUserTurns(activeAdapter, pendingPromptText);
    if (matchingTurns.length <= matchingChatGptUserTurnBaseline) return activeChatGptUserTurnAnchor;
    activeChatGptUserTurnAnchor = matchingTurns[matchingTurns.length - 1] ?? null;
    return activeChatGptUserTurnAnchor;
  }

  function elementFollows(anchor: Element, candidate: Element): boolean {
    if (anchor === candidate || typeof anchor.compareDocumentPosition !== 'function') return false;
    try {
      const position = anchor.compareDocumentPosition(candidate);
      return (
        (position & DOCUMENT_POSITION_DISCONNECTED) === 0 &&
        (position & DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    } catch {
      return false;
    }
  }

  function countResponseTextKeys(responses: Element[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const response of responses) {
      if (isUserMessageElement(response)) continue;
      const text = extractResponseText(response);
      if (!text) continue;
      const key = compactVisibleText(text);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  function responseTextIsBeyondBaseline(text: string, responses: Element[]): boolean {
    const key = compactVisibleText(text);
    const baselineCount = responseBaselineTextCounts.get(key) ?? 0;
    if (baselineCount === 0) return true;
    let currentCount = 0;
    for (const response of responses) {
      if (isUserMessageElement(response)) continue;
      const currentText = extractResponseText(response);
      if (!currentText || compactVisibleText(currentText) !== key) continue;
      currentCount += 1;
      if (currentCount > baselineCount) return true;
    }
    return false;
  }

  function initialSendConfirmationDelay(activeAdapter: AdapterConfig): number {
    return activeAdapter.provider === 'chatgpt'
      ? CHATGPT_INITIAL_SEND_CONFIRMATION_DELAY_MS
      : SEND_RETRY_DELAY_MS;
  }

  function fallbackSendConfirmationDelay(activeAdapter: AdapterConfig): number {
    return activeAdapter.provider === 'chatgpt'
      ? CHATGPT_FALLBACK_SEND_CONFIRMATION_DELAY_MS
      : SEND_FINAL_VERIFY_DELAY_MS;
  }

  function sendStarted(activeAdapter: AdapterConfig): boolean {
    if (!waitingForResponse) return true;
    if (activeAdapter.provider === 'chatgpt') {
      return refreshChatGptUserTurnAnchor(activeAdapter) !== null;
    }
    if (isThinking()) return true;
    const responses = document.querySelectorAll(activeAdapter.responseSelectors.join(', '));
    const latest = responses.length > 0 ? responses[responses.length - 1] : null;
    if (latest && latest !== lastSeenResponseEl) return true;
    const currentInput = queryInput(activeAdapter);
    if (activeAdapter.provider === 'grok') {
      return Boolean(
        currentInput &&
          currentInput === lastActivatedInput &&
          !getInputText(currentInput).trim(),
      );
    }
    return Boolean(currentInput && !getInputText(currentInput).trim());
  }

  function querySendButton(activeAdapter: AdapterConfig, input: Element): Element | null {
    const closest = (input as Element & { closest?: (selectors: string) => Element | null }).closest;
    if (typeof closest === 'function') {
      const container = closest.call(input, 'form, fieldset, [data-testid*="composer"]');
      if (container) {
        for (const selector of activeAdapter.sendButtonSelectors) {
          const candidate = container.querySelector(selector);
          if (candidate) return candidate;
        }
      }
    }
    return queryFirst(activeAdapter.sendButtonSelectors);
  }

  function execInsertText(text: string): boolean {
    if (typeof document.execCommand !== 'function') return false;
    try {
      return document.execCommand('insertText', false, text);
    } catch (error) {
      throw new InputInjectionError(`execCommand insertText threw: ${errorMessage(error)}`);
    }
  }

  function clickElement(el: Element, label: string): boolean {
    if (isDisabled(el)) return false;
    tryFocus(el, label);
    const click = (el as HTMLElement).click;
    if (typeof click !== 'function') return false;
    try {
      click.call(el);
      return true;
    } catch (error) {
      logEngine(`${label} click failed: ${errorMessage(error)}`);
      return false;
    }
  }

  function isDisabled(el: Element): boolean {
    const element = el as HTMLElement & { disabled?: boolean };
    return Boolean(
      element.disabled ||
        element.hasAttribute?.('disabled') ||
        element.getAttribute?.('aria-disabled') === 'true' ||
        element.getAttribute?.('data-disabled') === 'true',
    );
  }

  function dispatchEnter(input: Element): boolean {
    tryFocus(input, 'send input');
    const target = document.activeElement ?? input;
    if (dispatchEnterToTarget(target)) return true;
    if (target !== input) return dispatchEnterToTarget(input);
    return false;
  }

  function dispatchEnterToTarget(target: Element): boolean {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    try {
      const keydown = target.dispatchEvent(new KeyboardEvent('keydown', opts));
      const keypress = target.dispatchEvent(new KeyboardEvent('keypress', opts));
      const keyup = target.dispatchEvent(new KeyboardEvent('keyup', opts));
      if (!keydown || !keypress || !keyup) logEngine('enter event consumed by provider');
      return true;
    } catch (error) {
      logEngine(`enter dispatch failed: ${errorMessage(error)}`);
      return false;
    }
  }

  function tryFocus(el: Element, label: string): boolean {
    const focus = (el as HTMLElement).focus;
    if (typeof focus !== 'function') return false;
    try {
      focus.call(el);
      if (document.activeElement && document.activeElement !== el) {
        logEngine(`${label} focus did not become active`);
      }
      return true;
    } catch (error) {
      logEngine(`${label} focus failed: ${errorMessage(error)}`);
      return false;
    }
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function logEngine(message: string) {
    try {
      console.info(`[MAC engine] ${message}`);
    } catch {
      // best effort diagnostic only
    }
  }
})();
