import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS } from '../../shared/constants';
import { buildHtml } from '../ui/exportHtml';
import type { ExportMessage } from '../ui/exportMarkdown';

const fixedDate = new Date(2026, 6, 4, 13, 45, 7);

describe('HTML export', () => {
  // The whole point of the .html next to the .md: a browser draws the table, so a table that
  // arrived as a drawing or as one flattened line has to reach the file as <table>, not as the
  // monospaced art it was.
  it('renders a drawn table as a real table', async () => {
    const drawn = ['┌────────┬──────┐', '│ repo   │ 落後 │', '├────────┼──────┤', '│ cua    │ 158  │', '└────────┴──────┘'].join('\n');
    const { content } = await buildHtml([{ role: 'ai', provider: 'grok', content: drawn }], 'free', fixedDate);

    expect(content).toContain('<table');
    expect(content).toContain('<th');
    expect(content).toContain('repo');
    expect(content).toContain('<td');
    expect(content).toContain('158');
    expect(content).not.toContain('┌');
  });

  it('carries the same heading, provenance, and marks as the markdown export', async () => {
    const messages: ExportMessage[] = [
      { role: 'user', content: 'question' },
      { role: 'ai', provider: 'chatgpt', modeRole: 'pro', content: 'answer' },
    ];
    const { content, title } = await buildHtml(messages, 'debate', fixedDate, { appVersion: '1.0.2' });

    expect(content).toContain(`<title>${title}`);
    expect(content).toContain('<li>App version: 1.0.2</li>');
    expect(content).toContain(`${AI_PROVIDERS.chatgpt.name} (pro)`);
    // The mark travels as data: these files are read away from the app, with no assets beside them.
    expect(content).toContain('<img class="mark" src="data:image/png;base64,');
  });

  it('escapes anything in a message that would otherwise become markup', async () => {
    const { content } = await buildHtml([{ role: 'ai', content: '<script>alert(1)</script>' }], 'free', fixedDate);

    expect(content).not.toContain('<script>alert(1)</script>');
    expect(content).toContain('&lt;script&gt;');
  });
});
