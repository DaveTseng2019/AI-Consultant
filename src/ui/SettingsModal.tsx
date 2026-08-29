import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider, ProviderState } from '../../shared/types';
import { buildAdapterPermissionSummary } from './adapterPermissions';
import { AdapterAccessPanel } from './FocusPane';
import { useI18n } from '../i18n/context';
import { formatI18n } from '../i18n/t';
import type { PresentationByProvider } from './presentation';
import {
  type AppSettings,
  DEFAULT_FONT_SIZE,
  DEFAULT_READING_FONT_SIZE,
  MIN_FONT_SIZE,
  normalizeSettings,
} from './settingsModel';
import {
  MODE_ROLE_FIELDS,
  MODE_ROLE_LABEL_KEYS,
  MODE_ROLE_MODE_LABEL_KEYS,
  assignModeRole,
  type ModeRoleAssignments,
} from './modeRoleAssignment';
import { compareVersions, fetchLatestRelease } from './updateCheck';
import { host } from '../host';
import {
  filterEventLogByProvider,
  formatEventLogText,
  formatRelativeTime,
  providerName,
  type EventLogEvent,
  type EventLogProviderFilter,
} from '../diagnostics/eventLog';
import { buildDebugBundle, debugBundleFilename } from '../diagnostics/debugBundle';
import { useEventLog } from './useEventLog';
import { ModalDialog } from './ModalDialog';
import { ProviderLogo } from './ProviderLogo';
import { createSettingsPersistence } from './settingsPersistence';
import { createTrailingDebounce, type TrailingDebounce } from './trailingDebounce';

const PROVIDERS = Object.keys(AI_PROVIDERS) as AIProvider[];

type UpdateCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; version: string }
  | { status: 'available'; tagName: string; htmlUrl: string; portableAssetUrl?: string }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

interface SettingsError {
  messageKey: 'settings.loadFailed' | 'settings.saveFailed';
  detail?: string;
}

type FontSizeField = 'fontSize' | 'readingFontSize';
type FontSizePatch = Partial<Record<FontSizeField, number>>;

interface PendingFontSizeUpdate {
  updateSeq: number;
}

export function SettingsModal({
  open,
  openProviders,
  focusPaneWidth,
  presentation,
  providerStates,
  activeModeRoleSettings,
  onClose,
  onSaved,
}: {
  open: boolean;
  openProviders: AIProvider[];
  focusPaneWidth: number;
  presentation: PresentationByProvider;
  providerStates: Record<AIProvider, ProviderState>;
  activeModeRoleSettings?: keyof ModeRoleAssignments;
  onClose: () => void;
  onSaved: (settings: AppSettings) => void;
}) {
  const { t, setLanguage } = useI18n();
  const roleModes = Object.keys(MODE_ROLE_FIELDS) as (keyof ModeRoleAssignments)[];
  const orderedRoleModes = activeModeRoleSettings
    ? [activeModeRoleSettings, ...roleModes.filter((roleMode) => roleMode !== activeModeRoleSettings)]
    : roleModes;
  const [draft, setDraft] = useState<AppSettings | undefined>();
  const [fontSizeText, setFontSizeText] = useState<Partial<Record<FontSizeField, string>>>({});
  const [expandedRoleModes, setExpandedRoleModes] = useState<(keyof ModeRoleAssignments)[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SettingsError | undefined>();
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckState>({ status: 'idle' });
  const [versionLabel, setVersionLabel] = useState('');
  const closeTimerRef = useRef<number | undefined>();
  const settingsPersistenceRef = useRef(createSettingsPersistence(host.settings));
  const fontSizeDebounceRef = useRef<TrailingDebounce<PendingFontSizeUpdate> | undefined>(undefined);
  const pendingFontSizePatchRef = useRef<FontSizePatch>({});
  const modalSessionRef = useRef(0);
  const updateCheckSeqRef = useRef(0);
  const draftUpdateSeqRef = useRef(0);
  const languageUpdateSeqRef = useRef(0);
  const fontSizeUpdateSeqRef = useRef(0);
  const immediatePersistSeqRef = useRef(0);
  const liveRef = useRef({ openProviders, focusPaneWidth, presentation });
  liveRef.current = { openProviders, focusPaneWidth, presentation };

  useEffect(() => {
    if (!open) return;
    setExpandedRoleModes(activeModeRoleSettings ? [activeModeRoleSettings] : []);
  }, [activeModeRoleSettings, open]);

  // Read once per opening, before anything is clicked: which build the user is holding is the
  // first thing the update section has to answer, not something the check produces.
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void (async () => {
      const stamped = await host.app.versionLabel().catch(() => '');
      const label = stamped || (await host.app.version().catch(() => ''));
      if (!disposed) setVersionLabel(label.trim());
    })();
    return () => {
      disposed = true;
    };
  }, [open]);

  useEffect(() => {
    const modalSession = ++modalSessionRef.current;
    if (!open) return;
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    let disposed = false;
    setDraft(undefined);
    fontSizeDebounceRef.current?.cancel();
    pendingFontSizePatchRef.current = {};
    setFontSizeText({});
    setSaved(false);
    setSaving(false);
    setError(undefined);
    setUpdateCheck({ status: 'idle' });
    void settingsPersistenceRef.current
      .load()
      .then((loaded) => {
        if (disposed || modalSession !== modalSessionRef.current) return;
        const live = liveRef.current;
        setError(undefined);
        setDraft({
          ...loaded,
          openProviders: live.openProviders,
          focusPaneWidth: live.focusPaneWidth,
          presentation: live.presentation,
        });
      })
      .catch((reason: unknown) => {
        if (disposed || modalSession !== modalSessionRef.current) return;
        setError({ messageKey: 'settings.loadFailed', detail: errorDetail(reason) });
        const fallback = normalizeSettings({});
        const live = liveRef.current;
        settingsPersistenceRef.current.replaceCurrent(fallback);
        setDraft({
          ...fallback,
          openProviders: live.openProviders,
          focusPaneWidth: live.focusPaneWidth,
          presentation: live.presentation,
        });
      });
    return () => {
      disposed = true;
    };
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== undefined) window.clearTimeout(closeTimerRef.current);
      fontSizeDebounceRef.current?.cancel();
    },
    [],
  );

  if (!open) return null;

  const updateDraft = (patch: Partial<AppSettings>) => {
    draftUpdateSeqRef.current += 1;
    setSaved(false);
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  // Only the draft is touched; the dialog being dismissed leaves the current path alone.
  const pickArchiveScript = async () => {
    const chosen = await host.share.pickArchiveScript();
    if (chosen) updateDraft({ archiveScript: chosen });
  };

  const persistSettingsPatch = (patch: Partial<AppSettings>): Promise<AppSettings> =>
    settingsPersistenceRef.current.update(() => {
      const live = liveRef.current;
      return {
        ...patch,
        openProviders: live.openProviders,
        focusPaneWidth: live.focusPaneWidth,
        presentation: live.presentation,
      };
    });

  const updateLanguage = async (language: AppSettings['language']) => {
    const modalSession = modalSessionRef.current;
    const updateSeq = ++languageUpdateSeqRef.current;
    setError(undefined);
    updateDraft({ language });
    setLanguage(language);
    try {
      const next = await persistSettingsPatch({ language });
      onSaved(next);
      if (modalSession === modalSessionRef.current) setError(undefined);
    } catch (reason) {
      if (updateSeq === languageUpdateSeqRef.current) {
        const persistedLanguage = settingsPersistenceRef.current.current()?.language ?? 'system';
        setLanguage(persistedLanguage);
        if (modalSession === modalSessionRef.current) {
          updateDraft({ language: persistedLanguage });
          setError({ messageKey: 'settings.saveFailed', detail: errorDetail(reason) });
        }
      }
    }
  };

  // Persists immediately, unlike most fields in this modal which wait for the explicit Save
  // button. Reserved for fields with no real risk if they take effect right away (a toggle, a
  // display choice, a role assignment) -- fields that touch privacy, network trust, or run a
  // script (snapshotPersistence, adapterBaseUrl, archiveScript, archiveConfirm, ...) still gate
  // on the explicit Save so nothing consequential applies without a deliberate confirm click.
  const persistDraftFieldImmediately = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const modalSession = modalSessionRef.current;
    const updateSeq = ++immediatePersistSeqRef.current;
    setError(undefined);
    updateDraft({ [key]: value } as Partial<AppSettings>);
    try {
      const next = await persistSettingsPatch({ [key]: value } as Partial<AppSettings>);
      onSaved(next);
      if (modalSession === modalSessionRef.current) setError(undefined);
    } catch (reason) {
      if (updateSeq === immediatePersistSeqRef.current) {
        const persisted = settingsPersistenceRef.current.current();
        if (modalSession === modalSessionRef.current) {
          if (persisted) updateDraft({ [key]: persisted[key] } as Partial<AppSettings>);
          setError({ messageKey: 'settings.saveFailed', detail: errorDetail(reason) });
        }
      }
    }
  };

  const persistFontSize = async ({ updateSeq }: PendingFontSizeUpdate) => {
    const modalSession = modalSessionRef.current;
    const patch = pendingFontSizePatchRef.current;
    pendingFontSizePatchRef.current = {};
    try {
      const next = await persistSettingsPatch(patch);
      onSaved(next);
      if (modalSession === modalSessionRef.current) setError(undefined);
    } catch (reason) {
      if (updateSeq === fontSizeUpdateSeqRef.current && modalSession === modalSessionRef.current) {
        const persisted = settingsPersistenceRef.current.current();
        const reverted: FontSizePatch = {};
        if (patch.fontSize !== undefined) reverted.fontSize = persisted?.fontSize ?? DEFAULT_FONT_SIZE;
        if (patch.readingFontSize !== undefined) {
          reverted.readingFontSize = persisted?.readingFontSize ?? DEFAULT_READING_FONT_SIZE;
        }
        updateDraft(reverted);
        setFontSizeText({});
        setError({ messageKey: 'settings.saveFailed', detail: errorDetail(reason) });
      }
      throw reason;
    }
  };

  if (!fontSizeDebounceRef.current) {
    fontSizeDebounceRef.current = createTrailingDebounce((update) => persistFontSize(update), 250);
  }

  const scheduleFontSizeUpdate = (patch: FontSizePatch) => {
    const updateSeq = ++fontSizeUpdateSeqRef.current;
    setError(undefined);
    updateDraft(patch);
    pendingFontSizePatchRef.current = { ...pendingFontSizePatchRef.current, ...patch };
    fontSizeDebounceRef.current?.schedule({ updateSeq });
  };

  const closeSettings = async () => {
    const modalSession = modalSessionRef.current;
    try {
      await fontSizeDebounceRef.current?.flush();
      if (modalSession === modalSessionRef.current) onClose();
    } catch {
      // persistFontSize already restored the last persisted value and exposed the error.
    }
  };

  const save = async () => {
    if (!draft) return;
    const modalSession = modalSessionRef.current;
    const draftUpdateSeq = draftUpdateSeqRef.current;
    const languageUpdateSeq = ++languageUpdateSeqRef.current;
    fontSizeUpdateSeqRef.current += 1;
    fontSizeDebounceRef.current?.cancel();
    pendingFontSizePatchRef.current = {};
    setSaving(true);
    setError(undefined);
    try {
      const next = await persistSettingsPatch({
        ...draft,
        openProviders,
        focusPaneWidth,
        presentation,
      });
      onSaved(next);
      if (modalSession === modalSessionRef.current && draftUpdateSeq === draftUpdateSeqRef.current) {
        setSaved(true);
        closeTimerRef.current = window.setTimeout(onClose, 400);
      }
    } catch (reason) {
      if (languageUpdateSeq === languageUpdateSeqRef.current) {
        setLanguage(settingsPersistenceRef.current.current()?.language ?? 'system');
      }
      if (modalSession === modalSessionRef.current && draftUpdateSeq === draftUpdateSeqRef.current) {
        setError({ messageKey: 'settings.saveFailed', detail: errorDetail(reason) });
      }
    } finally {
      if (modalSession === modalSessionRef.current) setSaving(false);
    }
  };

  const checkForUpdates = async () => {
    const modalSession = modalSessionRef.current;
    const updateCheckSeq = ++updateCheckSeqRef.current;
    const isCurrent = () => modalSession === modalSessionRef.current && updateCheckSeq === updateCheckSeqRef.current;
    setUpdateCheck({ status: 'checking' });
    try {
      const currentVersion = await host.app.version();
      if (!isCurrent()) return;
      const latest = await fetchLatestRelease();
      if (!isCurrent()) return;
      if (!latest) {
        setUpdateCheck({ status: 'unavailable' });
        return;
      }
      if (compareVersions(currentVersion, latest.tagName)) {
        setUpdateCheck({
          status: 'available',
          tagName: latest.tagName,
          htmlUrl: latest.htmlUrl,
          ...(latest.portableAssetUrl ? { portableAssetUrl: latest.portableAssetUrl } : {}),
        });
      } else {
        setUpdateCheck({ status: 'up-to-date', version: currentVersion });
      }
    } catch (reason) {
      if (!isCurrent()) return;
      setUpdateCheck({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  return (
    <ModalDialog
      titleId="settings-title"
      onEscape={closeSettings}
      onBackdrop={closeSettings}
      panelClassName="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-lg border border-zinc-300 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
    >
        <div className="mb-4 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3">
          <h2 id="settings-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('settings.title')}</h2>
          <button type="button" className="border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={closeSettings}>
            {t('settings.close')}
          </button>
        </div>

        {draft ? (
          <div className="space-y-5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('settings.general')}</h3>
            <section>
              <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.language')}</span>
                <select
                  value={draft.language}
                  onChange={(event) => {
                    void updateLanguage(event.target.value as AppSettings['language']);
                  }}
                  className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
                >
                  <option value="system">{t('settings.language.system')}</option>
                  <option value="en">{t('settings.language.en')}</option>
                  <option value="zh-TW">{t('settings.language.zhTW')}</option>
                  <option value="ja">{t('settings.language.ja')}</option>
                  <option value="de">{t('settings.language.de')}</option>
                </select>
              </label>
            </section>

            <section>
              <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.responseLanguage')}</span>
                <select
                  value={draft.responseLanguage}
                  aria-describedby="settings-response-language-description"
                  onChange={(event) =>
                    void persistDraftFieldImmediately('responseLanguage', event.target.value as AppSettings['responseLanguage'])
                  }
                  className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
                >
                  <option value="auto">{t('settings.responseLanguage.auto')}</option>
                  <option value="en">{t('settings.language.en')}</option>
                  <option value="zh-TW">{t('settings.language.zhTW')}</option>
                  <option value="ja">{t('settings.language.ja')}</option>
                  <option value="de">{t('settings.language.de')}</option>
                </select>
              </label>
              <p id="settings-response-language-description" className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                {t('settings.responseLanguageDescription')}
              </p>
            </section>

            <section>
              <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.theme')}</span>
                <select
                  value={draft.theme}
                  onChange={(event) => void persistDraftFieldImmediately('theme', event.target.value as AppSettings['theme'])}
                  className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
                >
                  <option value="light">{t('settings.themeLight')}</option>
                  <option value="dark">{t('settings.themeDark')}</option>
                </select>
              </label>
            </section>

            <section className="grid grid-cols-2 gap-2">
              <FontSizeField
                label={t('settings.fontSize')}
                field="fontSize"
                value={draft.fontSize}
                text={fontSizeText.fontSize}
                onText={(text) => setFontSizeText((current) => ({ ...current, fontSize: text }))}
                onCommit={(value) => scheduleFontSizeUpdate({ fontSize: value })}
              />
              <FontSizeField
                label={t('settings.readingFontSize')}
                field="readingFontSize"
                value={draft.readingFontSize}
                text={fontSizeText.readingFontSize}
                onText={(text) => setFontSizeText((current) => ({ ...current, readingFontSize: text }))}
                onCommit={(value) => scheduleFontSizeUpdate({ readingFontSize: value })}
              />
            </section>

            <section>
              <label className="flex items-start gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={draft.monospaceFont}
                  onChange={(event) => void persistDraftFieldImmediately('monospaceFont', event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-700"
                />
                <span>
                  <span className="block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.monospaceFont')}</span>
                  <span className="mt-1 block leading-relaxed">{t('settings.monospaceFontDescription')}</span>
                </span>
              </label>
            </section>

            <section>
              <label className="flex items-start gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={draft.autoNewConversationOnStart}
                  onChange={(event) => void persistDraftFieldImmediately('autoNewConversationOnStart', event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-700"
                />
                <span>
                  <span className="block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.autoNewConversationOnStart')}</span>
                  <span className="mt-1 block leading-relaxed">{t('settings.autoNewConversationOnStartDescription')}</span>
                </span>
              </label>
              <label className="mt-3 flex items-start gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={draft.collapseHistoryOnNewConversation}
                  onChange={(event) => void persistDraftFieldImmediately('collapseHistoryOnNewConversation', event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-700"
                />
                <span>
                  <span className="block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.collapseHistoryOnNewConversation')}</span>
                  <span className="mt-1 block leading-relaxed">{t('settings.collapseHistoryOnNewConversationDescription')}</span>
                </span>
              </label>
            </section>

            <section className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('settings.modeRoles')}</h3>
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">{t('settings.modeRolesDescription')}</p>
              {orderedRoleModes.map((roleMode) => (
                <details
                  key={roleMode}
                  open={expandedRoleModes.includes(roleMode)}
                  onToggle={(event) => {
                    const expanded = event.currentTarget.open;
                    setExpandedRoleModes((current) =>
                      expanded
                        ? current.includes(roleMode) ? current : [...current, roleMode]
                        : current.filter((currentMode) => currentMode !== roleMode),
                    );
                  }}
                  className="rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {t(MODE_ROLE_MODE_LABEL_KEYS[roleMode])}
                  </summary>
                  <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
                    {MODE_ROLE_FIELDS[roleMode].map((role) => (
                      <label key={role} className="block text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="mb-1 block">{t(MODE_ROLE_LABEL_KEYS[roleMode][role])}</span>
                        <select
                          value={(draft.modeRoles[roleMode] as unknown as Record<string, AIProvider>)[role]}
                          onChange={(event) =>
                            void persistDraftFieldImmediately(
                              'modeRoles',
                              assignModeRole(draft.modeRoles, roleMode, role, event.target.value as AIProvider),
                            )
                          }
                          className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
                        >
                          {PROVIDERS.map((provider) => (
                            <option key={provider} value={provider}>{AI_PROVIDERS[provider].name}</option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            </section>

            <section className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{t('settings.privacyHistory')}</h3>
              <label className="flex items-start gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={draft.snapshotPersistence}
                  onChange={(event) => updateDraft({ snapshotPersistence: event.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-sky-700"
                />
                <span>
                  <span className="block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.durableSnapshots')}</span>
                  <span className="mt-1 block leading-relaxed">
                    {t('settings.durableSnapshotsDescription')}
                  </span>
                </span>
              </label>
              {draft.snapshotPersistence ? (
                <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="mb-1 block">{t('settings.snapshotRedactionTier')}</span>
                  <select
                    value={draft.snapshotRedactionTier}
                    onChange={(event) =>
                      updateDraft({ snapshotRedactionTier: event.target.value as AppSettings['snapshotRedactionTier'] })
                    }
                    className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
                  >
                    <option value="metadata-only">{t('settings.snapshotTierMetadataOnly')}</option>
                    <option value="hashes">{t('settings.snapshotTierHashes')}</option>
                    <option value="prompt-text">{t('settings.snapshotTierPromptText')}</option>
                    <option value="full-local">{t('settings.snapshotTierFullLocal')}</option>
                  </select>
                </label>
              ) : null}
              {/* Hidden only where the archived notes would be placeholders: durable snapshots ON at a
                  redacting tier, where the file the script reads holds no text. With them OFF the
                  export writes its own full-local file for the run, so the button is worth offering. */}
              {!draft.snapshotPersistence || draft.snapshotRedactionTier === 'full-local' ? (
                <div className="space-y-3">
                  <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="mb-1 block">{t('settings.archiveScript')}</span>
                    <span className="flex gap-2">
                      <input
                        type="text"
                        spellCheck={false}
                        value={draft.archiveScript}
                        onChange={(event) => updateDraft({ archiveScript: event.target.value })}
                        className="min-w-0 flex-1 border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
                      />
                      <button
                        type="button"
                        className="shrink-0 border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        onClick={() => void pickArchiveScript()}
                      >
                        {t('settings.archiveScriptBrowse')}
                      </button>
                    </span>
                    <span className="mt-1 block leading-relaxed">{t('settings.archiveScriptDescription')}</span>
                  </label>
                  <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="mb-1 block">{t('settings.archiveLabel')}</span>
                    <input
                      type="text"
                      value={draft.archiveLabel}
                      placeholder={t('settings.archiveLabel')}
                      onChange={(event) => updateDraft({ archiveLabel: event.target.value })}
                      className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
                    />
                    <span className="mt-1 block leading-relaxed">{t('settings.archiveLabelDescription')}</span>
                  </label>
                  <label className="flex items-start gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                    <input
                      type="checkbox"
                      checked={draft.archiveConfirm}
                      onChange={(event) => updateDraft({ archiveConfirm: event.target.checked })}
                      className="mt-0.5 h-4 w-4 accent-sky-700"
                    />
                    <span>
                      <span className="block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.archiveConfirm')}</span>
                      <span className="mt-1 block leading-relaxed">{t('settings.archiveConfirmDescription')}</span>
                    </span>
                  </label>
                </div>
              ) : null}
            </section>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button type="button" className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100" onClick={closeSettings}>
                {t('settings.cancel')}
              </button>
              <button
                type="button"
                className="min-w-16 border border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950 px-3 py-1.5 text-sm text-sky-700 dark:text-sky-100 hover:bg-sky-100 dark:hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void save()}
                disabled={!draft || saving}
              >
                {saved ? t('settings.saved') : t('settings.save')}
              </button>
            </div>

            {/* Portable builds check too. The button only opens a page in the browser -- exactly
                what README-portable.txt used to ask the user to do by hand -- so there was nothing
                for the marker to protect them from. */}
            <section className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <span className="block text-xs text-zinc-600 dark:text-zinc-400">{t('settings.updates')}</span>
                <span className="block text-xs text-zinc-800 dark:text-zinc-200">
                  {t('settings.currentVersion')}: {versionLabel || '—'}
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => void checkForUpdates()}
                    disabled={updateCheck.status === 'checking'}
                  >
                    {updateCheck.status === 'checking' ? t('settings.checking') : t('settings.checkForUpdates')}
                  </button>
                  {updateCheck.status === 'up-to-date' ? (
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{t('settings.upToDate').replace('{version}', updateCheck.version)}</span>
                  ) : null}
                  {updateCheck.status === 'available' ? (
                    <span className="text-xs text-sky-700 dark:text-sky-300">
                      {t('settings.newVersionAvailable').replace('{version}', updateCheck.tagName)} {'->'}{' '}
                      {/* A portable install replaces itself by unzipping, so send it straight at the
                          zip rather than at a page listing installers it must not run. */}
                      <button
                        type="button"
                        className="underline hover:text-sky-800 dark:hover:text-sky-200"
                        onClick={() =>
                          void host.app.openExternal(
                            draft.portable && updateCheck.portableAssetUrl ? updateCheck.portableAssetUrl : updateCheck.htmlUrl,
                          )
                        }
                      >
                        {t(draft.portable && updateCheck.portableAssetUrl ? 'settings.downloadPortable' : 'settings.downloadPage')}
                      </button>
                    </span>
                  ) : null}
                  {updateCheck.status === 'unavailable' ? (
                    <span className="text-xs text-amber-700 dark:text-amber-300">{t('settings.releasesUnavailable')}</span>
                  ) : null}
                  {updateCheck.status === 'error' ? (
                    <span className="text-xs text-red-700 dark:text-red-300">{t('settings.updateCheckFailed')} {updateCheck.message}</span>
                  ) : null}
                </div>
            </section>

            <details className="group border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <summary className="cursor-pointer list-none rounded px-1 py-2 focus-visible:outline-offset-2">
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('settings.advanced')}</span>
                    <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{t('settings.advancedDescription')}</span>
                  </span>
                  <span className="text-zinc-500 transition group-open:rotate-180" aria-hidden="true">⌄</span>
                </span>
              </summary>
              <div className="mt-3 space-y-4 border-l-2 border-zinc-200 pl-4 dark:border-zinc-800">
                <section>
                  <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                    <span className="mb-1 block">{t('settings.adapterBaseUrl')}</span>
                    <input
                      value={draft.adapterBaseUrl}
                      onChange={(event) => updateDraft({ adapterBaseUrl: event.target.value })}
                      className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
                    />
                  </label>
                </section>
                <details className="group/access rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('provider.access')}</summary>
                  <AccessTransparencySection />
                </details>
                <details className="group/diagnostics rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('settings.diagnostics')}</summary>
                  <DiagnosticsSection providerStates={providerStates} settings={draft} />
                </details>
              </div>
            </details>
          </div>
        ) : (
          <div className="py-8 text-sm text-zinc-500 dark:text-zinc-500">{t('settings.loading')}</div>
        )}

        {error ? (
          <div className="mt-4 border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200" role="alert">
            <div>{t(error.messageKey)}</div>
            {error.detail ? (
              <details className="mt-2">
                <summary className="cursor-pointer font-medium">{t('settings.technicalDetails')}</summary>
                <code className="mt-1 block break-words text-[0.6875rem] opacity-80">{error.detail}</code>
              </details>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            <button
              type="button"
              className="text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
              onClick={() => void host.app.openExternal('https://github.com/DaveTseng2019/AI-Consultant')}
            >
              {t('settings.sourceRepo')}
            </button>
          </div>
        </div>
    </ModalDialog>
  );
}

type DebugBundleExportState =
  | { status: 'idle' }
  | { status: 'exporting' }
  | { status: 'saved'; message: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

// One panel, not one per provider: the scope is identical for all four, so four buttons that swap
// nothing but the name read as four different answers and send the reader looking for the
// difference. The marks the panel lists are what says the answer covers every provider.
function AccessTransparencySection() {
  const { locale, t } = useI18n();
  const summary = useMemo(() => buildAdapterPermissionSummary(undefined, undefined, locale), [locale]);

  return (
    <section className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
      <div>
        <h3 className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('provider.access')}</h3>
      </div>
      <AdapterAccessPanel id="settings-adapter-access" summary={summary} />
    </section>
  );
}

function DiagnosticsSection({
  providerStates,
  settings,
}: {
  providerStates: Record<AIProvider, ProviderState>;
  settings: AppSettings;
}) {
  const { t } = useI18n();
  const events = useEventLog();
  const [providerFilter, setProviderFilter] = useState<EventLogProviderFilter>('all');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [exportState, setExportState] = useState<DebugBundleExportState>({ status: 'idle' });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (exportState.status === 'idle' || exportState.status === 'exporting') return;
    const timer = window.setTimeout(() => setExportState({ status: 'idle' }), 5000);
    return () => window.clearTimeout(timer);
  }, [exportState]);

  const lastEventByProvider = useMemo(() => {
    const map = new Map<AIProvider, number>();
    for (const event of events) {
      if (event.provider) map.set(event.provider, event.ts);
    }
    return map;
  }, [events]);

  const filteredEvents = useMemo(() => filterEventLogByProvider(events, providerFilter), [events, providerFilter]);
  const recentEvents = useMemo(() => [...filteredEvents].reverse().slice(0, 120), [filteredEvents]);

  const copyLog = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(formatEventLogText(filteredEvents));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  const exportDebugBundle = async () => {
    setExportState({ status: 'exporting' });
    try {
      const generatedAt = new Date();
      const bundle = buildDebugBundle({
        appVersion: await host.app.version(),
        timestampMs: generatedAt.getTime(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        providerStates,
        settings,
        events,
      });
      const saved = await host.share.exportMarkdown(debugBundleFilename(generatedAt), bundle);
      setExportState(saved ? { status: 'saved', message: formatI18n(t('share.exported'), { path: saved }) } : { status: 'cancelled' });
    } catch (reason) {
      setExportState({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  return (
    <section className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('settings.diagnostics')}</h3>
          <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">{t('settings.diagnosticsDescription')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            {t('settings.provider')}
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value as EventLogProviderFilter)}
              className="border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
            >
              <option value="all">{t('settings.all')}</option>
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {providerName(provider)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void copyLog()}
            disabled={filteredEvents.length === 0}
          >
            {copyState === 'copied' ? t('settings.copied') : copyState === 'error' ? t('settings.copyFailed') : t('settings.copyLog')}
          </button>
          <button
            className="border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void exportDebugBundle()}
            disabled={exportState.status === 'exporting'}
          >
            {exportState.status === 'exporting' ? t('settings.exporting') : t('settings.exportDebugBundle')}
          </button>
        </div>
      </div>

      {exportState.status === 'saved' ? (
        <div className="border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">{exportState.message}</div>
      ) : null}
      {exportState.status === 'cancelled' ? (
        <div className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">{t('settings.exportCancelled')}</div>
      ) : null}
      {exportState.status === 'error' ? (
        <div className="border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-800 dark:text-red-200">
          {t('settings.exportFailed')} {exportState.message}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {PROVIDERS.map((provider) => {
          const state = providerStates[provider];
          const lastEvent = lastEventByProvider.get(provider);
          return (
            <div key={provider} className="border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                  <ProviderLogo provider={provider} className="h-4 w-4" />
                  <span className="truncate">{providerName(provider)}</span>
                </span>
                <span className="text-zinc-500 dark:text-zinc-500">{lastEvent ? formatRelativeTime(lastEvent, now) : t('settings.noEvents')}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-zinc-600 dark:text-zinc-400">
                <StatusPair label={t('settings.bridge')} value={state.bridge ?? 'unknown'} />
                <StatusPair label={t('settings.adapter')} value={state.adapter ?? 'ok'} />
                <StatusPair label={t('settings.login')} value={state.login} />
                <StatusPair label={t('settings.dom')} value={state.dom} />
                <StatusPair label={t('settings.thinking')} value={state.thinking ? t('settings.yes') : t('settings.no')} />
                <StatusPair label={t('settings.webview')} value={state.webview} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="max-h-72 overflow-auto border border-zinc-200 dark:border-zinc-800">
        {recentEvents.length === 0 ? (
          <div className="p-3 text-xs text-zinc-500 dark:text-zinc-500">{t('settings.noDiagnosticEvents')}</div>
        ) : (
          <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {recentEvents.map((event, index) => (
              <EventLogRow key={`${event.ts}-${index}-${event.kind}-${event.summary}`} event={event} now={now} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function StatusPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-zinc-500 dark:text-zinc-500">{label}: </span>
      <span className="break-words text-zinc-800 dark:text-zinc-200">{value}</span>
    </div>
  );
}

function EventLogRow({ event, now }: { event: EventLogEvent; now: number }) {
  return (
    <li className="px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-zinc-500 dark:text-zinc-500">
        <span>{formatRelativeTime(event.ts, now)}</span>
        <span className="border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-[0.6875rem] uppercase text-zinc-700 dark:text-zinc-300">{event.kind}</span>
        {event.provider ? (
          <span className="flex items-center gap-1 text-sky-700 dark:text-sky-300">
            <ProviderLogo provider={event.provider} className="h-3.5 w-3.5" />
            {providerName(event.provider)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 break-words text-zinc-800 dark:text-zinc-200">{event.summary}</div>
      {event.detail ? <code className="mt-1 block break-words text-[0.6875rem] text-zinc-500 dark:text-zinc-500">{JSON.stringify(event.detail)}</code> : null}
    </li>
  );
}

function errorDetail(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

// Both size boxes behave the same: type freely, persist what parses, and let the box fall back to
// the persisted value on blur so a half-typed number cannot stick.
function FontSizeField({
  label,
  field,
  value,
  text,
  onText,
  onCommit,
}: {
  label: string;
  field: FontSizeField;
  value: number;
  text?: string;
  onText: (text: string | undefined) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <label className="block text-xs text-zinc-600 dark:text-zinc-400">
      <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <input
        type="number"
        name={field}
        min={MIN_FONT_SIZE}
        step={1}
        value={text ?? String(value)}
        onChange={(event) => {
          const next = event.target.value;
          onText(next);
          const parsed = Number(next);
          if (Number.isFinite(parsed) && parsed >= MIN_FONT_SIZE) onCommit(parsed);
        }}
        onBlur={() => onText(undefined)}
        className="w-full border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-sky-500 dark:focus:border-sky-600"
      />
    </label>
  );
}

