import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AI_PROVIDERS } from '../../shared/constants';
import type { AIProvider, ProviderState } from '../../shared/types';
import { buildAdapterPermissionSummary } from './adapterPermissions';
import { AdapterAccessPanel } from './FocusPane';
import { useI18n } from '../i18n/context';
import { formatI18n } from '../i18n/t';
import type { PresentationByProvider } from './presentation';
import {
  activeProvidersForStandby,
  type AppSettings,
  type CustomAction,
  type CustomActionPayload,
  DEFAULT_FONT_SIZE,
  defaultSettings,
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
import { compareVersions, fetchLatestRelease, isLocalBuild } from './updateCheck';
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
import { createUniqueSuffix } from './uniqueId';
import { ProviderLogo } from './ProviderLogo';
import { createSettingsPersistence } from './settingsPersistence';
import { createTrailingDebounce, type TrailingDebounce } from './trailingDebounce';

const PROVIDERS = Object.keys(AI_PROVIDERS) as AIProvider[];

type UpdateCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'up-to-date'; version: string }
  | { status: 'local-build'; tagName: string }
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

interface PersistSettingsOptions {
  standbyProvider?: AIProvider;
}

// Exported for the persistence regression test; keeping the merge beside the
// modal makes its live-prop precedence explicit.
// eslint-disable-next-line react-refresh/only-export-components
export function applyStandbyProviderToLiveSettings(
  previousStandbyProvider: AIProvider,
  nextStandbyProvider: AIProvider,
  openProviders: readonly AIProvider[],
  presentation: PresentationByProvider,
): Pick<AppSettings, 'openProviders' | 'presentation'> {
  if (previousStandbyProvider === nextStandbyProvider) {
    return { openProviders: [...openProviders], presentation: { ...presentation } };
  }

  return {
    openProviders: openProviders.filter((provider) => provider !== nextStandbyProvider),
    presentation: {
      ...presentation,
      [previousStandbyProvider]: 'side',
      [nextStandbyProvider]: 'chip',
    },
  };
}

export function SettingsModal({
  open,
  openProviders,
  focusPaneWidth,
  presentation,
  providerStates,
  activeModeRoleSettings,
  providerSelectionDisabled = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  openProviders: AIProvider[];
  focusPaneWidth: number;
  presentation: PresentationByProvider;
  providerStates: Record<AIProvider, ProviderState>;
  activeModeRoleSettings?: keyof ModeRoleAssignments;
  providerSelectionDisabled?: boolean;
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
  const updateCheckAbortRef = useRef<AbortController | undefined>();
  const draftUpdateSeqRef = useRef(0);
  const languageUpdateSeqRef = useRef(0);
  const fontSizeUpdateSeqRef = useRef(0);
  const immediatePersistSeqRef = useRef(0);
  const liveRef = useRef({ openProviders, focusPaneWidth, presentation });
  const saveInFlightRef = useRef(false);
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
      // A dev run has no stamp file, so the label comes back as the pinned version. The bundle
      // carries the same describe for that case.
      const local = isLocalBuild(stamped) ? __GIT_DESCRIBE__ : '';
      const label = local || stamped || (await host.app.version().catch(() => ''));
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
      updateCheckAbortRef.current?.abort();
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

  const updateAction = (index: number, patch: Partial<CustomAction>) => {
    setDraft((current) =>
      current
        ? { ...current, customActions: current.customActions.map((action, i) => (i === index ? { ...action, ...patch } : action)) }
        : current,
    );
  };

  // The id is what Rust looks the script up by, so it has to be unique and it must survive a
  // rename: a name is a caption, not an identity.
  const addAction = () => {
    setDraft((current) =>
      current
        ? {
            ...current,
            customActions: [
              ...current.customActions,
              { id: `action-${createUniqueSuffix()}`, name: '', script: '', note: '', payload: 'run', confirm: true },
            ],
          }
        : current,
    );
  };

  // The list order is the toolbar order, so this is the only way to say which button comes first.
  const moveAction = (index: number, by: -1 | 1) => {
    setDraft((current) => {
      if (!current) return current;
      const target = index + by;
      if (target < 0 || target >= current.customActions.length) return current;
      const customActions = [...current.customActions];
      [customActions[index], customActions[target]] = [customActions[target], customActions[index]];
      return { ...current, customActions };
    });
  };

  const removeAction = (index: number) => {
    setDraft((current) =>
      current ? { ...current, customActions: current.customActions.filter((_, i) => i !== index) } : current,
    );
  };

  // Only the draft is touched; the dialog being dismissed leaves the current path alone.
  const pickActionScript = async (index: number) => {
    const chosen = await host.share.pickArchiveScript();
    if (chosen) updateAction(index, { script: chosen });
  };

  const persistSettingsPatch = (
    patch: Partial<AppSettings>,
    options: PersistSettingsOptions = {},
  ): Promise<AppSettings> =>
    settingsPersistenceRef.current.update(() => {
      const live = liveRef.current;
      const liveProviderSettings = options.standbyProvider
        ? applyStandbyProviderToLiveSettings(
            settingsPersistenceRef.current.current()?.standbyProvider ?? options.standbyProvider,
            options.standbyProvider,
            live.openProviders,
            live.presentation,
          )
        : { openProviders: [...live.openProviders], presentation: { ...live.presentation } };
      return {
        ...patch,
        ...liveProviderSettings,
        focusPaneWidth: live.focusPaneWidth,
      };
    });

  const applySavedSettings = (settings: AppSettings) => {
    // A queued autosave can start before React renders the new parent props.
    // Keep its live provider state aligned with the just-committed standby swap.
    liveRef.current = {
      openProviders: settings.openProviders,
      focusPaneWidth: settings.focusPaneWidth,
      presentation: settings.presentation,
    };
    onSaved(settings);
  };

  const updateLanguage = async (language: AppSettings['language']) => {
    const modalSession = modalSessionRef.current;
    const updateSeq = ++languageUpdateSeqRef.current;
    setError(undefined);
    updateDraft({ language });
    setLanguage(language);
    try {
      const next = await persistSettingsPatch({ language });
      applySavedSettings(next);
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
  const persistDraftPatchImmediately = async (patch: Partial<AppSettings>) => {
    const modalSession = modalSessionRef.current;
    const updateSeq = ++immediatePersistSeqRef.current;
    setError(undefined);
    updateDraft(patch);
    try {
      const next = await persistSettingsPatch(patch);
      applySavedSettings(next);
      if (modalSession === modalSessionRef.current) setError(undefined);
    } catch (reason) {
      if (updateSeq === immediatePersistSeqRef.current) {
        const persisted = settingsPersistenceRef.current.current();
        if (modalSession === modalSessionRef.current) {
          if (persisted) {
            const reverted: Partial<AppSettings> = {};
            for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
              (reverted as Record<string, unknown>)[key] = persisted[key];
            }
            updateDraft(reverted);
          }
          setError({ messageKey: 'settings.saveFailed', detail: errorDetail(reason) });
        }
      }
    }
  };

  const persistDraftFieldImmediately = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    persistDraftPatchImmediately({ [key]: value } as Partial<AppSettings>);

  const persistFontSize = async ({ updateSeq }: PendingFontSizeUpdate) => {
    const modalSession = modalSessionRef.current;
    const patch = pendingFontSizePatchRef.current;
    pendingFontSizePatchRef.current = {};
    try {
      const next = await persistSettingsPatch(patch);
      applySavedSettings(next);
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

  // Both sizes move by the same step, so the gap the two defaults set is kept whatever the user
  // has already typed into either box.
  const nudgeFontSizes = (by: 1 | -1) => {
    if (!draft) return;
    setFontSizeText({});
    scheduleFontSizeUpdate({
      fontSize: Math.max(MIN_FONT_SIZE, draft.fontSize + by),
      readingFontSize: Math.max(MIN_FONT_SIZE, draft.readingFontSize + by),
    });
  };

  // Only the appearance fields. A "defaults" button that also wiped the adapter URL, the custom
  // action list or the snapshot choices would be a different, much larger promise.
  const restoreInterfaceDefaults = async () => {
    const defaults = defaultSettings();
    fontSizeUpdateSeqRef.current += 1;
    fontSizeDebounceRef.current?.cancel();
    pendingFontSizePatchRef.current = {};
    setFontSizeText({});
    await persistDraftPatchImmediately({
      theme: defaults.theme,
      fontSize: defaults.fontSize,
      readingFontSize: defaults.readingFontSize,
      monospaceFont: defaults.monospaceFont,
    });
  };

  const updateStandbyProvider = (standbyProvider: AIProvider) => {
    if (!draft || standbyProvider === draft.standbyProvider || providerSelectionDisabled || saveInFlightRef.current) return;
    // Only the order changes: the standby keeps its roles, its open pane and its presentation.
    updateDraft({ standbyProvider });
  };

  const closeSettings = async () => {
    if (saveInFlightRef.current) return;
    const modalSession = modalSessionRef.current;
    try {
      await fontSizeDebounceRef.current?.flush();
      if (modalSession === modalSessionRef.current && !saveInFlightRef.current) {
        updateCheckAbortRef.current?.abort();
        onClose();
      }
    } catch {
      // persistFontSize already restored the last persisted value and exposed the error.
    }
  };

  const save = async () => {
    if (!draft || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    const modalSession = modalSessionRef.current;
    const draftUpdateSeq = draftUpdateSeqRef.current;
    const languageUpdateSeq = ++languageUpdateSeqRef.current;
    fontSizeUpdateSeqRef.current += 1;
    fontSizeDebounceRef.current?.cancel();
    pendingFontSizePatchRef.current = {};
    setSaving(true);
    setError(undefined);
    try {
      const next = await persistSettingsPatch(
        { ...draft },
        { standbyProvider: draft.standbyProvider },
      );
      applySavedSettings(next);
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
      saveInFlightRef.current = false;
      if (modalSession === modalSessionRef.current) setSaving(false);
    }
  };

  // The portable lane installs; every other lane can only be pointed at the release page. A failure
  // has to land back in this panel: the update runs after the app exits, so a swallowed error here
  // would look exactly like a successful update that changed nothing.
  const startUpdate = async (portableAssetUrl: string | undefined, htmlUrl: string) => {
    if (!draft?.portable || !portableAssetUrl) {
      await host.app.openExternal(htmlUrl);
      return;
    }
    try {
      await host.app.portableUpdate(portableAssetUrl, t('settings.portableUpdateConfirm'));
    } catch (reason) {
      setUpdateCheck({
        status: 'error',
        message: `${t('settings.portableUpdateFailed')} ${reason instanceof Error ? reason.message : String(reason)}`,
      });
    }
  };

  const checkForUpdates = async () => {
    updateCheckAbortRef.current?.abort();
    const controller = new AbortController();
    updateCheckAbortRef.current = controller;
    const modalSession = modalSessionRef.current;
    const updateCheckSeq = ++updateCheckSeqRef.current;
    const isCurrent = () =>
      !controller.signal.aborted &&
      modalSession === modalSessionRef.current &&
      updateCheckSeq === updateCheckSeqRef.current;
    setUpdateCheck({ status: 'checking' });
    try {
      const currentVersion = await host.app.version();
      if (!isCurrent()) return;
      const latest = await fetchLatestRelease(undefined, controller.signal);
      if (!isCurrent()) return;
      if (!latest) {
        setUpdateCheck({ status: 'unavailable' });
        return;
      }
      // A local build carries the pinned version, so it always compares as older than the newest
      // release and would be offered an update that overwrites the build under test. Report what is
      // out there and stop -- the version stamp above already says which build is in hand.
      if (isLocalBuild(currentVersion)) {
        setUpdateCheck({ status: 'local-build', tagName: latest.tagName });
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
      setUpdateCheck({
        status: 'error',
        message: `${t('settings.updateCheckFailed')} ${reason instanceof Error ? reason.message : String(reason)}`,
      });
    } finally {
      if (updateCheckAbortRef.current === controller) updateCheckAbortRef.current = undefined;
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
          <button type="button" className="border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50" onClick={closeSettings} disabled={saving}>
            {t('settings.close')}
          </button>
        </div>

        {draft ? (
          <div className="space-y-5">
            <SectionHeading>{t('settings.general')}</SectionHeading>
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
                  <option value="system">{t('settings.themeSystem')}</option>
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
              <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{t('settings.fontSizeSync')}</span>
                <button
                  type="button"
                  aria-label={t('settings.fontSizeSyncSmaller')}
                  onClick={() => nudgeFontSizes(-1)}
                  className="border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label={t('settings.fontSizeSyncLarger')}
                  onClick={() => nudgeFontSizes(1)}
                  className="border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  +
                </button>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                {t('settings.fontSizeSyncDescription')}
              </p>
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
              <button
                type="button"
                onClick={() => void restoreInterfaceDefaults()}
                className="border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {t('settings.restoreDefaults')}
              </button>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                {t('settings.restoreDefaultsDescription')}
              </p>
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
                  checked={draft.startMaximized}
                  onChange={(event) => void persistDraftFieldImmediately('startMaximized', event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-700"
                />
                <span>
                  <span className="block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.startMaximized')}</span>
                  <span className="mt-1 block leading-relaxed">{t('settings.startMaximizedDescription')}</span>
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

            <section className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {t('settings.providers')}
                </h3>
                <p id="settings-providers-description" className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                  {t('settings.providersDescription')}
                </p>
              </div>
              <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">
                  {t('settings.providersSelect')}
                </span>
                <select
                  value={draft.standbyProvider}
                  disabled={providerSelectionDisabled || saving}
                  aria-describedby={
                    providerSelectionDisabled ? 'settings-providers-unavailable' : 'settings-providers-description'
                  }
                  title={providerSelectionDisabled ? t('input.workflowRunning') : undefined}
                  onChange={(event) => updateStandbyProvider(event.target.value as AIProvider)}
                  className="w-full border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-sky-600"
                >
                  {PROVIDERS.map((provider) => (
                    <option key={provider} value={provider}>
                      {AI_PROVIDERS[provider].name}{provider === 'meta' ? ` — ${t('settings.providersDefault')}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {providerSelectionDisabled ? (
                <p id="settings-providers-unavailable" className="text-xs text-zinc-500 dark:text-zinc-500">
                  {t('input.workflowRunning')}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('settings.providers')}>
                {activeProvidersForStandby(draft.standbyProvider)
                  .filter((provider) => provider !== draft.standbyProvider)
                  .map((provider) => (
                    <span key={provider} className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                      {AI_PROVIDERS[provider].name} · {t('settings.providerActive')}
                    </span>
                  ))}
                <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {AI_PROVIDERS[draft.standbyProvider].name} · {t('settings.providerStandby')}
                </span>
              </div>
            </section>

            <section className="space-y-3 border-t border-zinc-200 dark:border-zinc-800 pt-4">
              <SectionHeading>{t('settings.modeRoles')}</SectionHeading>
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
                          {activeProvidersForStandby(draft.standbyProvider).map((provider) => (
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
              <SectionHeading>{t('settings.privacyHistory')}</SectionHeading>
              {/* Read by Rust before the window exists, so this one is saved like any other field
                  but only answers at the next launch -- the description says so. */}
              <label className="flex items-start gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={draft.singleInstance}
                  onChange={(event) => void persistDraftFieldImmediately('singleInstance', event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-700"
                />
                <span>
                  <span className="block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.singleInstance')}</span>
                  <span className="mt-1 block leading-relaxed">{t('settings.singleInstanceDescription')}</span>
                </span>
              </label>
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
            </section>

            {/* Its own section: these buttons are a feature of the toolbar, not of the privacy
                settings they used to hang off. Hidden only where an action that asks for the run
                would receive placeholders -- durable snapshots ON at a redacting tier. With them
                OFF the app writes its own full-local file for the run. */}
            {!draft.snapshotPersistence || draft.snapshotRedactionTier === 'full-local' ? (
              <section className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <SectionHeading>{t('settings.customActions')}</SectionHeading>
                  <span className="block text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {t('settings.customActionsDescription')}
                  </span>
                  {draft.customActions.map((action, index) => (
                    <div key={action.id} className="space-y-2 border border-zinc-200 p-3 dark:border-zinc-800">
                      <div className="flex gap-2">
                        <label className="min-w-0 flex-1 text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="mb-1 block">{t('settings.customActionName')}</span>
                          <input
                            type="text"
                            value={action.name}
                            onChange={(event) => updateAction(index, { name: event.target.value })}
                            className="w-full border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-sky-600"
                          />
                        </label>
                        <button
                          type="button"
                          className="mt-5 h-8 w-8 shrink-0 border border-zinc-300 text-xs text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          aria-label={t('settings.customActionMoveUp')}
                          title={t('settings.customActionMoveUp')}
                          disabled={index === 0}
                          onClick={() => moveAction(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="mt-5 h-8 w-8 shrink-0 border border-zinc-300 text-xs text-zinc-800 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          aria-label={t('settings.customActionMoveDown')}
                          title={t('settings.customActionMoveDown')}
                          disabled={index === draft.customActions.length - 1}
                          onClick={() => moveAction(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="mt-5 h-8 shrink-0 border border-zinc-300 px-3 text-xs text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                          onClick={() => removeAction(index)}
                        >
                          {t('settings.customActionRemove')}
                        </button>
                      </div>
                      <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="mb-1 block">{t('settings.customActionScript')}</span>
                        <span className="flex gap-2">
                          <input
                            type="text"
                            spellCheck={false}
                            value={action.script}
                            onChange={(event) => updateAction(index, { script: event.target.value })}
                            className="min-w-0 flex-1 border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-sky-600"
                          />
                          <button
                            type="button"
                            className="shrink-0 border border-zinc-300 px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                            onClick={() => void pickActionScript(index)}
                          >
                            {t('settings.archiveScriptBrowse')}
                          </button>
                        </span>
                      </label>
                      <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="mb-1 block">{t('settings.customActionNote')}</span>
                        <input
                          type="text"
                          value={action.note}
                          onChange={(event) => updateAction(index, { note: event.target.value })}
                          className="w-full border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-sky-600"
                        />
                      </label>
                      <label className="block text-xs text-zinc-600 dark:text-zinc-400">
                        <span className="mb-1 block">{t('settings.customActionPayload')}</span>
                        <select
                          value={action.payload}
                          onChange={(event) => updateAction(index, { payload: event.target.value as CustomActionPayload })}
                          className="w-full border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-sky-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-sky-600"
                        >
                          <option value="none">{t('settings.customActionPayloadNone')}</option>
                          <option value="run">{t('settings.customActionPayloadRun')}</option>
                          <option value="markdown">{t('settings.customActionPayloadMarkdown')}</option>
                        </select>
                        <span className="mt-1 block leading-relaxed">{t('settings.customActionPayloadDescription')}</span>
                      </label>
                      <label className="flex items-start gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                        <input
                          type="checkbox"
                          checked={action.confirm}
                          onChange={(event) => updateAction(index, { confirm: event.target.checked })}
                          className="mt-0.5 h-4 w-4 accent-sky-700"
                        />
                        <span>
                          <span className="block font-medium text-zinc-700 dark:text-zinc-300">{t('settings.archiveConfirm')}</span>
                          <span className="mt-1 block leading-relaxed">{t('settings.archiveConfirmDescription')}</span>
                        </span>
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="border border-zinc-300 px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    onClick={addAction}
                  >
                    {t('settings.customActionAdd')}
                  </button>
              </section>
            ) : null}

            <div className="flex items-center justify-end gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button type="button" className="px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 disabled:opacity-50" onClick={closeSettings} disabled={saving}>
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
                <SectionHeading>{t('settings.updates')}</SectionHeading>
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
                  {updateCheck.status === 'local-build' ? (
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">{t('settings.localBuildNoUpdate').replace('{version}', updateCheck.tagName)}</span>
                  ) : null}
                  {updateCheck.status === 'available' ? (
                    <span className="text-xs text-sky-700 dark:text-sky-300">
                      {t('settings.newVersionAvailable').replace('{version}', updateCheck.tagName)} {'->'}{' '}
                      {/* A portable install replaces itself by unzipping, so it does that itself
                          rather than sending the user to a page and a manual copy over this folder.
                          Anything else goes to the release page, which lists the installer. */}
                      {draft.portable && updateCheck.portableAssetUrl ? (
                        <button
                          type="button"
                          className="underline hover:text-sky-800 dark:hover:text-sky-200"
                          onClick={() => void startUpdate(updateCheck.portableAssetUrl, updateCheck.htmlUrl)}
                        >
                          {t('settings.installPortableUpdate')}
                        </button>
                      ) : (
                        <DownloadPageLink key={updateCheck.htmlUrl} url={updateCheck.htmlUrl} />
                      )}
                    </span>
                  ) : null}
                  {updateCheck.status === 'unavailable' ? (
                    <span className="text-xs text-amber-700 dark:text-amber-300">{t('settings.releasesUnavailable')}</span>
                  ) : null}
                  {updateCheck.status === 'error' ? (
                    <span className="text-xs text-red-700 dark:text-red-300">{updateCheck.message}</span>
                  ) : null}
                </div>
            </section>

            <details className="group border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <summary className="cursor-pointer list-none rounded px-1 py-2 focus-visible:outline-offset-2">
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block border-l-2 border-sky-500 pl-2 text-sm font-semibold uppercase tracking-wide text-zinc-900 dark:border-sky-400 dark:text-zinc-50">
                      {t('settings.advanced')}
                    </span>
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
                <code className="mt-1 block break-words text-xs opacity-80">{error.detail}</code>
              </details>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            <SettingsExternalLink
              url="https://github.com/DaveTseng2019/AI-Consultant"
              label={t('settings.sourceRepo')}
              errorMessage={t('settings.externalLinkFailed')}
              className="text-sky-700 underline underline-offset-2 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
            />
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
// One look for every top-level heading in this dialog: a size up from the labels beneath it, at the
// brightest text colour the theme has, with an accent rule down the side. The old headings were the
// dimmest text on the page, which put the section boundaries -- the thing you scan for -- last in
// line for the eye.
function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="border-l-2 border-sky-500 pl-2 text-sm font-semibold uppercase tracking-wide text-zinc-900 dark:border-sky-400 dark:text-zinc-50">
      {children}
    </h3>
  );
}

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

export function DiagnosticsSection({
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
  const copyGeneration = useRef(0);
  const [exportState, setExportState] = useState<DebugBundleExportState>({ status: 'idle' });
  const exportInFlight = useRef(false);
  const exportGeneration = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      copyGeneration.current += 1;
      exportGeneration.current += 1;
      window.clearInterval(timer);
    };
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
    const generation = ++copyGeneration.current;
    setCopyState('idle');
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(formatEventLogText(filteredEvents));
      if (generation === copyGeneration.current) setCopyState('copied');
    } catch {
      if (generation === copyGeneration.current) setCopyState('error');
    }
  };

  const exportDebugBundle = async () => {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    const generation = ++exportGeneration.current;
    setExportState({ status: 'exporting' });
    try {
      const generatedAt = new Date();
      const appVersion = await host.app.version();
      if (generation !== exportGeneration.current) return;
      const bundle = buildDebugBundle({
        appVersion,
        timestampMs: generatedAt.getTime(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        providerStates,
        settings,
        events,
      });
      const saved = await host.share.exportMarkdown(debugBundleFilename(generatedAt), bundle);
      if (generation !== exportGeneration.current) return;
      setExportState(saved ? { status: 'saved', message: formatI18n(t('share.exported'), { path: saved }) } : { status: 'cancelled' });
    } catch (reason) {
      if (generation !== exportGeneration.current) return;
      setExportState({ status: 'error', message: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      exportInFlight.current = false;
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
              onChange={(event) => {
                copyGeneration.current += 1;
                setCopyState('idle');
                setProviderFilter(event.target.value as EventLogProviderFilter);
              }}
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
                  <ProviderLogo provider={provider} />
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
        <span className="border border-zinc-300 dark:border-zinc-700 px-1.5 py-0.5 text-xs uppercase text-zinc-700 dark:text-zinc-300">{event.kind}</span>
        {event.provider ? (
          <span className="flex items-center gap-1 text-sky-700 dark:text-sky-300">
            <ProviderLogo provider={event.provider} />
            {providerName(event.provider)}
          </span>
        ) : null}
      </div>
      <div className="mt-1 break-words text-zinc-800 dark:text-zinc-200">{event.summary}</div>
      {event.detail ? <code className="mt-1 block break-words text-xs text-zinc-500 dark:text-zinc-500">{JSON.stringify(event.detail)}</code> : null}
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

export function DownloadPageLink({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <SettingsExternalLink
      url={url}
      label={t('settings.downloadPage')}
      errorMessage={t('settings.downloadPageFailed')}
    />
  );
}

export function SettingsExternalLink({
  url,
  label,
  errorMessage,
  className = 'underline hover:text-sky-800 dark:hover:text-sky-200',
}: {
  url: string;
  label: string;
  errorMessage: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'opening' | 'error'>();
  const inFlight = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  const openLink = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const request = ++generation.current;
    setStatus('opening');
    try {
      await host.app.openExternal(url);
      if (request === generation.current) setStatus(undefined);
    } catch {
      if (request === generation.current) setStatus('error');
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {status === 'error' ? (
        <span role="alert" className="text-red-700 dark:text-red-300">{errorMessage}</span>
      ) : null}
      <button
        type="button"
        className={`${className} disabled:cursor-wait disabled:opacity-50`}
        disabled={status === 'opening'}
        onClick={() => void openLink()}
      >
        {status === 'error' ? t('provider.retry') : label}
      </button>
    </span>
  );
}
