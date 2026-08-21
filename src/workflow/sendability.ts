import type { ProviderState } from '../../shared/types';

// notes: the logged_in requirement is stricter than the providers are. Only Claude actually refuses
//        an anonymous prompt; ChatGPT, Grok and Gemini all answer signed out. Relaxing this was
//        considered on 2026-08-20 and rejected: a signed-out page and an expired session look the
//        same in the DOM -- the engine checks loggedOutDetectors before the login detectors,
//        precisely because a stale composer survives session expiry -- so dropping the gate trades
//        a missing capability for silently failed sends. Revisit only with a signal that separates
//        the two, such as the redirect an expired session takes; the DOM alone will not do it.
export function isSendable(state: ProviderState): boolean {
  return state.webview === 'loaded' && state.dom === 'ready' && state.login === 'logged_in';
}
