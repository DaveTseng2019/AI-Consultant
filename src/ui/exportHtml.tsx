import { AI_PROVIDERS } from '../../shared/constants';
import { PROVIDER_LOGOS } from '../assets/providers/logos';
import type { ChatMode } from '../../shared/types';
import {
  exportProvenanceLines,
  exportTitle,
  type ExportMessage,
  type ExportProvenance,
} from './exportMarkdown';
import { normalizeLinearTables, type LinearTableHeaders } from './linearTables';
import { MarkdownText } from './MarkdownText';

// The .html export is the .md export read by a browser instead of by a markdown viewer: same
// heading, same provenance, same marks. What it adds is that a table stays a table -- a browser
// draws one, and an answer that arrived as a drawn or a written-out table is turned back into rows
// before it is rendered.
export async function buildHtml(
  messages: ExportMessage[],
  mode: ChatMode,
  exportedAt: Date,
  provenance: ExportProvenance = {},
  tableHeaders: LinearTableHeaders = { key: 'Item', value: 'Value' },
): Promise<{ title: string; content: string }> {
  // Loaded only when someone exports: the server renderer is a second copy of React's rendering
  // path and has no business in the startup bundle of a desktop app.
  const { renderToStaticMarkup } = await import('react-dom/server');
  const title = exportTitle(mode, provenance);
  const markdown = (text: string) =>
    renderToStaticMarkup(<MarkdownText text={normalizeLinearTables(text, tableHeaders)} />);

  const sections = messages.map((message) => {
    if (message.role === 'user') {
      return `<section class="turn turn-user"><h2><span class="mark">👤</span>User</h2>${markdown(message.content)}</section>`;
    }
    const provider =
      message.provider && message.provider in AI_PROVIDERS
        ? (message.provider as keyof typeof AI_PROVIDERS)
        : undefined;
    const providerName = provider ? AI_PROVIDERS[provider].name : (message.provider ?? 'AI');
    const roleLabel = message.modeRole ? ` (${message.modeRole})` : '';
    // The mark travels as data, like the markdown export's: these files are read away from the app,
    // offline, with no assets folder beside them.
    const mark = provider
      ? `<img class="mark" src="${PROVIDER_LOGOS[provider]}" alt="">`
      : '<span class="mark">🧠</span>';
    return `<section class="turn"><h2>${mark}${escapeHtml(providerName + roleLabel)}</h2>${markdown(message.content)}</section>`;
  });

  const provenanceItems = exportProvenanceLines(exportedAt, provenance)
    .map((line) => `<li>${escapeHtml(line)}</li>`)
    .join('');

  const content = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<ul class="provenance">${provenanceItems}</ul>
${sections.join('\n')}
</body>
</html>
`;
  return { title, content };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// The app's own classes are Tailwind's and mean nothing outside the app, so the exported file is
// styled by element instead. One stylesheet, inline: the file has to survive being mailed on its own.
const STYLES = `
:root { color-scheme: light dark; --line: #d4d4d8; --muted: #52525b; --shade: #f4f4f5; }
@media (prefers-color-scheme: dark) {
  :root { --line: #3f3f46; --muted: #a1a1aa; --shade: #18181b; }
  body { background: #09090b; color: #e4e4e7; }
}
body {
  margin: 0 auto; max-width: 52rem; padding: 2rem 1rem 4rem;
  font-family: system-ui, "Segoe UI", "Microsoft JhengHei", sans-serif; line-height: 1.7;
}
h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
h2 { display: flex; align-items: center; gap: .5rem; font-size: 1.1rem; margin: 0 0 .75rem; }
.mark { width: 1.25rem; height: 1.25rem; border-radius: .1875rem; object-fit: contain; }
.provenance { list-style: none; margin: 0 0 2rem; padding: 0; color: var(--muted); font-size: .85rem; }
.turn { border-top: 1px solid var(--line); padding: 1.25rem 0; }
.turn-user { color: var(--muted); }
table { border-collapse: collapse; margin: 1rem 0; width: 100%; }
th, td { border: 1px solid var(--line); padding: .4rem .6rem; text-align: left; vertical-align: top; }
th { background: var(--shade); font-weight: 600; }
pre { background: var(--shade); border: 1px solid var(--line); border-radius: .375rem; padding: .75rem; overflow-x: auto; }
code { font-family: ui-monospace, Consolas, monospace; font-size: .9em; }
blockquote { border-left: 4px solid var(--line); margin: 1rem 0; padding-left: 1rem; color: var(--muted); }
img { max-width: 100%; }
hr { border: 0; border-top: 1px solid var(--line); margin: 1.5rem 0; }
`;
