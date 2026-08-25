import { AI_PROVIDERS, CHAT_MODES } from '../../shared/constants';
import type { ChatMode } from '../../shared/types';
import { formatLocalTimestamp, localFilenameStamp, localTimezoneLabel } from '../formatTime';
import type { ExecutionSnapshot } from '../workflow/snapshot/types';

/** Structural subset of App.tsx's Bubble that export needs. */
export interface ExportMessage {
  role: 'user' | 'ai';
  provider?: string;
  modeRole?: string;
  content: string;
}

export interface ExportProvenance {
  appVersion?: string;
  snapshot?: ExecutionSnapshot;
  preset?: {
    id: string;
    icon: string;
    name: string;
  };
}

export function matchingSnapshotForConversation(
  messages: readonly ExportMessage[],
  snapshot: ExecutionSnapshot | undefined,
): ExecutionSnapshot | undefined {
  if (!snapshot || snapshot.userQuestion.kind !== 'inline') return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') return message.content === snapshot.userQuestion.text ? snapshot : undefined;
  }
  return undefined;
}

export function buildMarkdown(
  messages: ExportMessage[],
  mode: ChatMode,
  exportedAt: Date,
  provenance: ExportProvenance = {},
): { title: string; content: string } {
  const modeInfo = provenance.preset ?? CHAT_MODES[mode];
  const title = `AI Consultant — ${modeInfo.icon} ${modeInfo.name}`;
  const lines: string[] = [
    `# ${title}`,
    `> Exported: ${formatLocalTimestamp(exportedAt)} ${localTimezoneLabel(exportedAt)}`,
  ];
  if (provenance.appVersion) lines.push(`> App version: ${provenance.appVersion}`);
  if (provenance.snapshot) appendSnapshotProvenance(lines, provenance.snapshot);
  lines.push('', '---', '');
  for (const msg of messages) {
    if (msg.role === 'user') {
      lines.push('## 👤 User', '');
      lines.push(...msg.content.split('\n').map((line) => `> ${line}`));
    } else {
      const providerName = msg.provider
        ? (AI_PROVIDERS[msg.provider as keyof typeof AI_PROVIDERS]?.name ?? msg.provider)
        : 'AI';
      const roleLabel = msg.modeRole ? ` (${msg.modeRole})` : '';
      lines.push(`## 🤖 ${providerName}${roleLabel}`, '');
      lines.push(msg.content);
    }
    lines.push('', '---', '');
  }
  return { title, content: lines.join('\n') };
}

function appendSnapshotProvenance(lines: string[], snapshot: ExecutionSnapshot): void {
  lines.push(`> Latest workflow: ${snapshot.graphId} v${snapshot.graphVersion}`);
  lines.push(`> Latest snapshot: ${snapshot.snapshotId}`);
  lines.push(`> Latest run app version: ${snapshot.appVersion}`);
  // The snapshot stores UTC ISO strings. Show them on the same local 24-hour clock as the rest of
  // the export, and leave an unparseable value alone rather than printing "Invalid Date".
  const runStart = snapshotTime(snapshot.createdAt);
  const runEnd = snapshot.completedAt ? snapshotTime(snapshot.completedAt) : undefined;
  lines.push(`> Latest run: ${runStart}${runEnd ? ` → ${runEnd}` : ''} (${localTimezoneLabel()})`);
  const adapterVersions = Object.entries(snapshot.adapterVersions)
    .filter((entry): entry is [keyof typeof AI_PROVIDERS, number] => entry[0] in AI_PROVIDERS && typeof entry[1] === 'number')
    .map(([provider, version]) => `${AI_PROVIDERS[provider].name} v${version}`);
  if (adapterVersions.length > 0) lines.push(`> Adapter versions: ${adapterVersions.join(', ')}`);
}

function snapshotTime(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? formatLocalTimestamp(parsed) : value;
}

/** `ai-consultant-<mode>-YYYY-MM-DD-HH-mm-ss.md` */
export function exportFilename(mode: ChatMode, exportedAt: Date, presetId?: string): string {
  return `ai-consultant-${presetId ?? mode}-${localFilenameStamp(exportedAt)}.md`;
}
