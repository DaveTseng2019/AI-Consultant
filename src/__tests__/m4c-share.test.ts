import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS, CHAT_MODES } from '../../shared/constants';
import {
  buildMarkdown,
  exportFilename,
  matchingSnapshotForConversation,
  type ExportMessage,
} from '../ui/exportMarkdown';
import type { ExecutionSnapshot } from '../workflow/snapshot/types';

// Local wall clock, not a UTC literal: the export renders local time, so a UTC fixture would only
// hold in one timezone.
const fixedDate = new Date(2026, 6, 4, 13, 45, 7);
const runStart = new Date(2026, 6, 4, 13, 40, 0);
const runEnd = new Date(2026, 6, 4, 13, 44, 0);

describe('M4c share export helpers', () => {
  it('renders the mode title, exported line, and separators', () => {
    const mode = 'debate';
    const { content, title } = buildMarkdown([], mode, fixedDate);

    expect(title).toBe(`AI Consultant — ${CHAT_MODES[mode].icon} ${CHAT_MODES[mode].name}`);
    expect(content.split('\n')[0]).toBe(`# ${title}`);
    expect(content).toMatch(/^> Exported: 2026-07-04 13:45:07 UTC[+-]\d{2}:\d{2}$/m);
    expect(content).toContain('\n---\n');
  });

  it('renders multiline user messages as blockquotes', () => {
    const messages: ExportMessage[] = [{ role: 'user', content: 'first line\nsecond line' }];
    const { content } = buildMarkdown(messages, 'free', fixedDate);

    expect(content).toContain('## 👤 User\n\n> first line\n> second line');
  });

  // The mark is what tells a reader whose turn this is without reading the name, which is the point
  // of exporting a four-way conversation. It has to travel WITH the file -- these are read offline,
  // away from the app -- so the definition carries the image data itself, and one definition serves
  // every answer a provider gave rather than a blob per heading.
  it('heads each answer with the provider mark, embedded once for the whole file', () => {
    const messages: ExportMessage[] = [
      { role: 'ai', provider: 'chatgpt', modeRole: 'pro', content: 'answer' },
      { role: 'ai', provider: 'chatgpt', content: 'more' },
    ];
    const { content } = buildMarkdown(messages, 'debate', fixedDate);

    expect(content).toContain(`## ![][chatgpt] ${AI_PROVIDERS.chatgpt.name} (pro)\n\nanswer`);
    expect(content.match(/^\[chatgpt\]: data:image\/png;base64,/gm)).toHaveLength(1);
    expect(content).not.toContain('[claude]:');
  });

  it('falls back to the raw provider string for unknown providers', () => {
    const messages: ExportMessage[] = [{ role: 'ai', provider: 'system', content: 'notice' }];
    const { content } = buildMarkdown(messages, 'free', fixedDate);

    expect(content).toContain('## 🧠 system\n\nnotice');
  });

  it('renders an empty export as only the header block', () => {
    const { content } = buildMarkdown([], 'consult', fixedDate);

    expect(content).not.toContain('## 👤 User');
    expect(content).not.toContain('## 🧠');
    expect(content.split('\n')).toHaveLength(5);
  });

  it('labels brainstorm exports without changing their underlying free mode', () => {
    const preset = { id: 'brainstorm', icon: '✨', name: 'Brainstorm' };
    const { content, title } = buildMarkdown([], 'free', fixedDate, { preset });

    expect(title).toBe('AI Consultant — ✨ Brainstorm');
    expect(content.split('\n')[0]).toBe('# AI Consultant — ✨ Brainstorm');
    expect(exportFilename('free', fixedDate, preset.id)).toBe('ai-consultant-brainstorm-2026-07-04-13-45-07.md');
  });

  it('renders app, workflow, snapshot, timing, and adapter provenance', () => {
    const snapshot = buildSnapshot();
    const { content } = buildMarkdown([{ role: 'user', content: 'question' }], 'roundtable', fixedDate, {
      appVersion: '1.0.2',
      snapshot,
    });

    expect(content).toContain('> App version: 1.0.2');
    expect(content).toContain('> Latest workflow: roundtable v1');
    expect(content).toContain('> Latest snapshot: snapshot-export');
    expect(content).toContain('> Latest run app version: 1.0.1');
    expect(content).toMatch(/^> Latest run: 2026-07-04 13:40:00 → 2026-07-04 13:44:00 \(UTC[+-]\d{2}:\d{2}\)$/m);
    expect(content).toContain(`> Adapter versions: ${AI_PROVIDERS.chatgpt.name} v7, ${AI_PROVIDERS.claude.name} v8`);
  });

  it('only attaches the latest snapshot to its own conversation question', () => {
    const snapshot = buildSnapshot();

    expect(matchingSnapshotForConversation([{ role: 'user', content: 'question' }], snapshot)).toBe(snapshot);
    expect(matchingSnapshotForConversation([{ role: 'user', content: 'another topic' }], snapshot)).toBeUndefined();
    expect(
      matchingSnapshotForConversation(
        [
          { role: 'user', content: 'question' },
          { role: 'ai', provider: 'chatgpt', content: 'answer' },
          { role: 'user', content: 'follow-up' },
        ],
        snapshot,
      ),
    ).toBeUndefined();
  });

  it('builds deterministic markdown filenames from ISO timestamps', () => {
    expect(exportFilename('debate', fixedDate)).toBe('ai-consultant-debate-2026-07-04-13-45-07.md');
  });
});

function buildSnapshot(): ExecutionSnapshot {
  return {
    snapshotId: 'snapshot-export',
    graphId: 'roundtable',
    graphVersion: 1,
    appVersion: '1.0.1',
    createdAt: runStart.toISOString(),
    completedAt: runEnd.toISOString(),
    adapterVersions: { chatgpt: 7, claude: 8 },
    roleMap: {},
    redactionTier: 'full-local',
    userQuestion: { tier: 'full-local', kind: 'inline', text: 'question' },
    steps: [],
    humanEdits: [],
  };
}
