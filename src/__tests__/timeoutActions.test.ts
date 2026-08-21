import { beforeEach, describe, expect, it, vi } from 'vitest';
import { host } from '../host';
import { takeVisibleAnswer } from '../ui/timeoutActions';

vi.mock('../host', () => ({
  host: {
    provider: {
      send: vi.fn(),
      fill: vi.fn(),
      eval: vi.fn(),
      evalWithCallback: vi.fn(),
    },
    connections: {
      get: vi.fn(),
    },
    bridge: {
      subscribeTitle: vi.fn(),
    },
    sessionCheckpoint: {
      save: vi.fn(),
      load: vi.fn(),
      clear: vi.fn(),
    },
  },
}));

const FINISH_SNIPPET =
  "window.__MAC_ENGINE__ && typeof window.__MAC_ENGINE__.finish === 'function' && window.__MAC_ENGINE__.finish();";

describe('take the answer the user can already see', () => {
  beforeEach(() => {
    vi.mocked(host.provider.eval).mockReset();
    vi.mocked(host.provider.eval).mockResolvedValue(undefined);
  });

  it('asks that provider page to hand its response over now', () => {
    takeVisibleAnswer('grok');

    // The page owns the response text, so ending the wait has to go through the engine: the
    // button must not resolve the step on its own or the transcript loses the answer.
    expect(host.provider.eval).toHaveBeenCalledWith('grok', FINISH_SNIPPET);
  });

  it('ignores a provider the app does not know', () => {
    takeVisibleAnswer('not-a-provider');

    expect(host.provider.eval).not.toHaveBeenCalled();
  });
});
