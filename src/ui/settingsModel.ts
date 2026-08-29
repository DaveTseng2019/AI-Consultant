import type { AIProvider } from '../../shared/types';
import { AI_PROVIDERS } from '../../shared/constants';
import { DEFAULT_COLUMN_WIDTHS, type ColumnWidths, clampColumnWidths } from './dockLayout';
import { DEFAULT_FOCUS_PANE_WIDTH, clampFocusPaneWidth } from './focusLayout';
import {
  DEFAULT_SLOT_ASSIGNMENT,
  SLOT_IDS,
  type SlotAssignment,
  normalizeSlotAssignment,
} from './slotAssignment';
import {
  type ModeRoleAssignments,
  migrateLegacyModeRoleAssignments,
  normalizeModeRoleAssignments,
} from './modeRoleAssignment';
import { isSnapshotRedactionTier, type SnapshotRedactionTier } from '../workflow/snapshot/types';
import { defaultPresentation, normalizePresentation, type PresentationByProvider } from './presentation';
import type { CenterSurface } from './FocusPane';
import {
  normalizeLanguageSetting,
  normalizeResponseLanguageSetting,
  type LanguageSetting,
  type ResponseLanguageSetting,
} from '../i18n/resolve';

/**
 * One user-defined button in the conversation toolbar. The app knows nothing about what the script
 * does with the run; it only hands it over and reports how it ended.
 *
 * notes: PowerShell only for now, which is what the path check enforces. A future entry kind (a
 *        Claude skill, say) would be a `kind` field here plus its own branch in run_custom_action.
 */
export type CustomActionPayload = 'none' | 'run' | 'markdown';

const CUSTOM_ACTION_PAYLOADS: readonly CustomActionPayload[] = ['none', 'run', 'markdown'];

export interface CustomAction {
  /** Stable across renames, because it is what the frontend sends to Rust to pick the script. */
  id: string;
  /** Button caption. */
  name: string;
  /** Absolute path of a .ps1. Validated in Rust as well, where it is actually run. */
  script: string;
  /** Shown as the button's tooltip. For the person who wrote it, six months later. */
  note: string;
  /**
   * What the button hands the script:
   * - `none`: nothing. A utility that has no business with the conversation.
   * - `run`: `-SnapshotId <this run>`, the recorded question and answers.
   * - `markdown`: `-MarkdownPath <file>`, this conversation exported as .md. The opener is then
   *   the script's choice, which is the only way it can be right -- Windows has no default
   *   program for .md, so "just open it" opens nothing on most machines.
   */
  payload: CustomActionPayload;
  /** Ask before running. */
  confirm: boolean;
}

export interface AppSettings {
  settingsSchemaVersion: number;
  language: LanguageSetting;
  responseLanguage: ResponseLanguageSetting;
  theme: 'light' | 'dark';
  /** Interface text: everything outside the transcript and the centre stage, via the root font size. */
  fontSize: number;
  /** The reading size, for the transcript bubbles and the centre stage text view only. */
  readingFontSize: number;
  /** Render the whole app in a monospace stack. Code and tabular answers line up; prose does not. */
  monospaceFont: boolean;
  autoNewConversationOnStart: boolean;
  /** Collapse the conversation history list when the New conversation button is pressed. */
  collapseHistoryOnNewConversation: boolean;
  layoutMode: 'focus';
  focusPaneWidth: number;
  columnWidths: ColumnWidths;
  slotAssignment: SlotAssignment;
  modeRoles: ModeRoleAssignments;
  openProviders: AIProvider[];
  adapterBaseUrl: string;
  updaterChannel: string;
  portable: boolean;
  telemetry: 'none';
  snapshotPersistence: boolean;
  snapshotRedactionTier: SnapshotRedactionTier;
  /** The toolbar's user-defined buttons, in the order they are shown. No cap. */
  customActions: CustomAction[];
  /** One copy of the app at a time; a second launch raises the window already open. Read in Rust
   *  before the window exists, so a change only takes effect at the next launch. */
  singleInstance: boolean;
  presentation: PresentationByProvider;
  /** Which face the centre stage last showed. Only the user's own enlarge/collapse writes it. */
  centerSurface: CenterSurface;
}

const PROVIDERS = Object.keys(AI_PROVIDERS) as AIProvider[];
export const SETTINGS_SCHEMA_VERSION = 1;

export function defaultSettings(): AppSettings {
  return {
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    language: 'system',
    responseLanguage: 'auto',
    theme: 'light',
    fontSize: DEFAULT_FONT_SIZE,
    readingFontSize: DEFAULT_READING_FONT_SIZE,
    monospaceFont: false,
    autoNewConversationOnStart: false,
    collapseHistoryOnNewConversation: false,
    layoutMode: 'focus',
    focusPaneWidth: DEFAULT_FOCUS_PANE_WIDTH,
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    slotAssignment: { ...DEFAULT_SLOT_ASSIGNMENT },
    modeRoles: normalizeModeRoleAssignments(undefined),
    openProviders: [],
    adapterBaseUrl: '',
    updaterChannel: 'stable',
    portable: false,
    telemetry: 'none',
    snapshotPersistence: false,
    snapshotRedactionTier: 'metadata-only',
    customActions: [],
    singleInstance: true,
    presentation: defaultPresentation(),
    centerSurface: 'text',
  };
}

/**
 * The list, or the single archive script a settings.json written before the list is carried into it.
 * Dropping the old fields silently would take away a button the user had already configured.
 */
function customActions(input: Record<string, unknown>): CustomAction[] {
  const stored = Array.isArray(input.customActions) ? input.customActions : undefined;
  if (stored) {
    return stored
      .map((entry, index) => customAction(entry, index))
      .filter((action): action is CustomAction => action !== undefined);
  }

  const legacyScript = stringValue(input.archiveScript, '').trim();
  if (!legacyScript) return [];
  return [
    {
      id: 'archive',
      name: stringValue(input.archiveLabel, '').trim(),
      script: legacyScript,
      note: '',
      payload: 'run',
      confirm: input.archiveConfirm !== false,
    },
  ];
}

function customAction(value: unknown, index: number): CustomAction | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Partial<Record<keyof CustomAction, unknown>>;
  const script = stringValue(entry.script, '').trim();
  if (!script) return undefined;
  return {
    id: stringValue(entry.id, '').trim() || `action-${index}`,
    name: stringValue(entry.name, '').trim(),
    script,
    note: stringValue(entry.note, '').trim(),
    payload: customActionPayload(entry),
    confirm: entry.confirm !== false,
  };
}

/** `passRun` is what the first version of the list stored; true meant the run, false meant nothing. */
function customActionPayload(entry: Partial<Record<string, unknown>>): CustomActionPayload {
  const stored = entry.payload;
  if (typeof stored === 'string' && (CUSTOM_ACTION_PAYLOADS as readonly string[]).includes(stored)) {
    return stored as CustomActionPayload;
  }
  return entry.passRun === false ? 'none' : 'run';
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function providerList(value: unknown): AIProvider[] {
  if (!Array.isArray(value)) return [];
  return value.filter((provider): provider is AIProvider => PROVIDERS.includes(provider));
}

function snapshotRedactionTier(value: unknown, fallback: SnapshotRedactionTier): SnapshotRedactionTier {
  return isSnapshotRedactionTier(value) ? value : fallback;
}

function centerSurface(value: unknown, fallback: CenterSurface): CenterSurface {
  return value === 'text' || value === 'native' ? value : fallback;
}

function theme(value: unknown, fallback: AppSettings['theme']): AppSettings['theme'] {
  return value === 'light' || value === 'dark' ? value : fallback;
}

export const DEFAULT_FONT_SIZE = 18;
// 讀的字比操作的字大一級：主版面是拿來看完整回答的，介面只是標籤與按鈕。
export const DEFAULT_READING_FONT_SIZE = 20;
// 下限 10px，避免 UI 縮到無法操作；依需求不限制上限。
export const MIN_FONT_SIZE = 10;

function fontSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_FONT_SIZE ? value : fallback;
}

function columnWidths(value: unknown, fallback: ColumnWidths): ColumnWidths {
  if (!value || typeof value !== 'object') return { ...fallback };
  const input = value as Partial<Record<keyof ColumnWidths, unknown>>;
  return clampColumnWidths(
    {
      left: typeof input.left === 'number' ? input.left : fallback.left,
      right: typeof input.right === 'number' ? input.right : fallback.right,
    },
    1400,
  );
}

function legacyFocusPaneWidth(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<Record<keyof ColumnWidths, unknown>>;
  return typeof input.left === 'number' ? input.left : undefined;
}

function focusPaneWidth(value: unknown, legacyColumnWidths: unknown, fallback: number): number {
  const candidate = typeof value === 'number' ? value : legacyFocusPaneWidth(legacyColumnWidths) ?? fallback;
  return clampFocusPaneWidth(candidate, 1400);
}

export function normalizeSettings(value: unknown): AppSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object') return defaults;
  const input = value as Partial<Record<keyof AppSettings, unknown>>;
  const normalizedColumnWidths = columnWidths(input.columnWidths, defaults.columnWidths);
  const storedSchemaVersion =
    typeof input.settingsSchemaVersion === 'number' &&
    Number.isInteger(input.settingsSchemaVersion) &&
    input.settingsSchemaVersion >= 0
      ? input.settingsSchemaVersion
      : 0;

  return {
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    language: normalizeLanguageSetting(input.language),
    responseLanguage: normalizeResponseLanguageSetting(input.responseLanguage),
    theme: theme(input.theme, defaults.theme),
    fontSize: fontSize(input.fontSize, DEFAULT_FONT_SIZE),
    readingFontSize: fontSize(input.readingFontSize, DEFAULT_READING_FONT_SIZE),
    monospaceFont: input.monospaceFont === true,
    autoNewConversationOnStart: input.autoNewConversationOnStart === true,
    collapseHistoryOnNewConversation: input.collapseHistoryOnNewConversation === true,
    layoutMode: 'focus',
    focusPaneWidth: focusPaneWidth(input.focusPaneWidth, input.columnWidths, defaults.focusPaneWidth),
    columnWidths: normalizedColumnWidths,
    slotAssignment: normalizeSlotAssignment(input.slotAssignment, defaults.slotAssignment),
    modeRoles:
      storedSchemaVersion < SETTINGS_SCHEMA_VERSION
        ? migrateLegacyModeRoleAssignments(input.modeRoles, defaults.modeRoles)
        : normalizeModeRoleAssignments(input.modeRoles, defaults.modeRoles),
    openProviders: Array.from(new Set(providerList(input.openProviders))),
    adapterBaseUrl: stringValue(input.adapterBaseUrl, defaults.adapterBaseUrl),
    updaterChannel: stringValue(input.updaterChannel, defaults.updaterChannel),
    portable: input.portable === true,
    telemetry: 'none',
    snapshotPersistence: input.snapshotPersistence === true,
    snapshotRedactionTier: snapshotRedactionTier(input.snapshotRedactionTier, defaults.snapshotRedactionTier),
    customActions: customActions(input as Record<string, unknown>),
    singleInstance: input.singleInstance !== false,
    presentation: normalizePresentation(input.presentation, defaults.presentation),
    centerSurface: centerSurface(input.centerSurface, defaults.centerSurface),
  };
}

export function mergeSettings(loaded: unknown, patch: Partial<AppSettings>): AppSettings {
  return normalizeSettings({
    ...normalizeSettings(loaded),
    ...patch,
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  });
}

export function slotProviders(assignment: SlotAssignment, side: 'left' | 'right'): AIProvider[] {
  const slots = side === 'left' ? SLOT_IDS.slice(0, 2) : SLOT_IDS.slice(2);
  return slots.map((slot) => assignment[slot]);
}
