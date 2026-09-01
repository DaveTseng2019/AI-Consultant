import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { host } from '../host';
import { modeName } from '../i18n/modes';
import type { Locale } from '../i18n/resolve';
import { formatI18n, t } from '../i18n/t';
import { SessionCheckpointNotice } from '../ui/SessionCheckpointNotice';
import {
  clearStartupSessionCheckpointNotice,
  loadStartupSessionCheckpointNotice,
  type StartupSessionCheckpointNotice,
} from '../ui/sessionCheckpointStartup';

vi.mock('../host', () => ({
  host: {
    sessionCheckpoint: {
      load: vi.fn(),
      clear: vi.fn(),
    },
    snapshot: {
      list: vi.fn(),
    },
  },
}));

interface ElementProps {
  children?: ReactNode;
  onClick?: () => void;
}

function propsOf(element: ReactElement): ElementProps {
  return element.props as ElementProps;
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf(propsOf(node).children);
  return '';
}

function findAllElements(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap((child) => findAllElements(child, predicate));
  if (!isValidElement(node)) return [];

  const matches = predicate(node) ? [node] : [];
  return [...matches, ...findAllElements(propsOf(node).children, predicate)];
}

function firstElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement {
  const match = findAllElements(node, predicate)[0];
  if (!match) throw new Error('Expected element was not found');
  return match;
}

function notice(): StartupSessionCheckpointNotice {
  return {
    checkpoint: {
      graphId: 'debate',
      graphVersion: 1,
      mode: 'debate',
      questionHash: 'hash-only',
      stepIndex: 2,
      startedAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:01:00.000Z',
    },
    replaySnapshot: {
      id: 'snapshot-debate',
      graphId: 'debate',
      createdAt: '2026-07-06T00:02:00.000Z',
    },
  };
}

describe('SessionCheckpointNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(host.sessionCheckpoint.load).mockResolvedValue(null);
    vi.mocked(host.sessionCheckpoint.clear).mockResolvedValue(undefined);
    vi.mocked(host.snapshot.list).mockResolvedValue([]);
  });

  it('loads a startup checkpoint and same-graph replay snapshot', async () => {
    vi.mocked(host.sessionCheckpoint.load).mockResolvedValueOnce(JSON.stringify(notice().checkpoint));
    vi.mocked(host.snapshot.list).mockResolvedValueOnce([
      { id: 'snapshot-free', graphId: 'free', createdAt: '2026-07-06T00:00:30.000Z' },
      { id: 'snapshot-debate', graphId: 'debate', createdAt: '2026-07-06T00:00:01.000Z' },
    ]);

    await expect(loadStartupSessionCheckpointNotice()).resolves.toMatchObject({
      checkpoint: { graphId: 'debate', questionHash: 'hash-only' },
      replaySnapshot: { id: 'snapshot-debate' },
    });
  });

  // Killing the app mid-run leaves the checkpoint behind but no snapshot: the executor only writes
  // one on its way out. Offering Replay then would replay whatever that graph ran last time, which
  // is not what the notice says it is -- so the run has to own the snapshot, not just the graph.
  it('offers no replay when the interrupted run never wrote a snapshot', async () => {
    vi.mocked(host.sessionCheckpoint.load).mockResolvedValueOnce(JSON.stringify(notice().checkpoint));
    vi.mocked(host.snapshot.list).mockResolvedValueOnce([
      { id: 'snapshot-debate-earlier', graphId: 'debate', createdAt: '2026-07-05T23:00:00.000Z' },
    ]);

    await expect(loadStartupSessionCheckpointNotice()).resolves.toMatchObject({
      checkpoint: { graphId: 'debate' },
      replaySnapshot: undefined,
    });
  });

  it('takes the newest snapshot the interrupted run itself wrote', async () => {
    vi.mocked(host.sessionCheckpoint.load).mockResolvedValueOnce(JSON.stringify(notice().checkpoint));
    vi.mocked(host.snapshot.list).mockResolvedValueOnce([
      { id: 'snapshot-debate-this-run', graphId: 'debate', createdAt: '2026-07-06T00:00:02.000Z' },
      { id: 'snapshot-debate-earlier', graphId: 'debate', createdAt: '2026-07-05T23:00:00.000Z' },
    ]);

    await expect(loadStartupSessionCheckpointNotice()).resolves.toMatchObject({
      replaySnapshot: { id: 'snapshot-debate-this-run' },
    });
  });

  it.each(['en', 'zh-TW'] as const)('renders the %s startup notice and wires Dismiss and Replay actions', (locale: Locale) => {
    const onDismiss = vi.fn();
    const onReplay = vi.fn();
    const tree = SessionCheckpointNotice({ notice: notice(), onDismiss, onReplay, locale });
    const html = renderToStaticMarkup(tree);

    expect(html).toContain(formatI18n(t('sessionCheckpoint.interrupted', locale), { mode: modeName('debate', locale) }));
    expect(html).toContain(`${t('sessionCheckpoint.step', locale)} 2`);

    propsOf(firstElement(tree, (element) => element.type === 'button' && textOf(element).includes(t('sessionCheckpoint.dismiss', locale)))).onClick?.();
    expect(onDismiss).toHaveBeenCalledTimes(1);

    propsOf(firstElement(tree, (element) => element.type === 'button' && textOf(element).includes(t('sessionCheckpoint.replay', locale)))).onClick?.();
    expect(onReplay).toHaveBeenCalledTimes(1);
  });

  it('clears the checkpoint when the startup notice is dismissed', async () => {
    await clearStartupSessionCheckpointNotice();

    expect(host.sessionCheckpoint.clear).toHaveBeenCalledTimes(1);
  });
});
