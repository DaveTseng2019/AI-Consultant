import { Children, isValidElement, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider, ProviderState } from '../../shared/types';
import { host } from '../host';
import { t } from '../i18n/t';
import { SettingsModal } from '../ui/SettingsModal';
import { DEFAULT_FONT_SIZE, defaultSettings, type AppSettings } from '../ui/settingsModel';
import { createSettingsPersistence } from '../ui/settingsPersistence';

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useEffect: vi.fn(), useState: vi.fn(react.useState), useRef: vi.fn(react.useRef) };
});
vi.mock('../i18n/context', () => ({
  useI18n: () => ({ t: (key: Parameters<typeof t>[0]) => t(key, 'en'), setLanguage: vi.fn(), locale: 'en' }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface ControlProps {
  children?: ReactNode;
  value?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onClick?: () => void;
}

function control(node: ReactNode, matches: (element: ReactElement<ControlProps>) => boolean): ReactElement<ControlProps> | undefined {
  if (!isValidElement<ControlProps>(node)) return undefined;
  if (matches(node)) return node;
  for (const child of Children.toArray(node.props.children)) {
    const found = control(child, matches);
    if (found) return found;
  }
}

function harness(initial: AppSettings) {
  const states: unknown[] = [initial];
  const refs: { current: unknown }[] = [];
  const persistence = createSettingsPersistence(host.settings);
  persistence.replaceCurrent(initial);
  refs[1] = { current: persistence };
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const render = () => {
    let stateIndex = 0;
    let refIndex = 0;
    vi.mocked(useState).mockImplementation((initialValue?: unknown) => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [states[index], (next: unknown) => {
        states[index] = typeof next === 'function' ? next(states[index]) : next;
      }] as [unknown, (next: unknown) => void];
    });
    vi.mocked(useRef).mockImplementation((initialValue) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initialValue }));
    return SettingsModal({
      open: true,
      openProviders: initial.openProviders,
      focusPaneWidth: initial.focusPaneWidth,
      presentation: initial.presentation,
      providerStates: {} as Record<AIProvider, ProviderState>,
      onClose,
      onSaved,
    });
  };
  return { render, onSaved, onClose };
}

const SEED_URL = 'https://seed.example';
const NEXT_URL = 'https://next.example';
const seeded = (): AppSettings => ({ ...defaultSettings(), adapterBaseUrl: SEED_URL });
const dirtyDraft = (tree: ReactNode) =>
  control(tree, (element) => element.type === 'input' && element.props.value === SEED_URL)!
    .props.onChange!({ target: { value: NEXT_URL } });

describe('SettingsModal tabs', () => {
  interface TabbedProps extends ControlProps {
    role?: string;
    id?: string;
    hidden?: boolean;
  }
  const elementById = (tree: ReactNode, id: string) => control(tree, (element) => (element.props as TabbedProps).id === id)!;
  const byId = (tree: ReactNode, id: string) => elementById(tree, id).props as TabbedProps;
  const tabIds = (tree: ReactNode): string[] => {
    const ids: string[] = [];
    const walk = (node: ReactNode) => {
      if (!isValidElement<TabbedProps>(node)) return;
      if (node.props.role === 'tab' && node.props.id) ids.push(node.props.id);
      Children.toArray(node.props.children).forEach(walk);
    };
    walk(tree);
    return ids;
  };

  const saveButton = (tree: ReactNode) =>
    control(tree, (element) => element.type === 'button' && element.props.children === t('settings.save', 'en'));

  // The page was one long scroll; now one group shows at a time.
  it('shows one group at a time and switches on click', () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    const ui = harness(defaultSettings());

    let tree = ui.render();
    expect(byId(tree, 'settings-panel-general').hidden).toBe(false);
    expect(byId(tree, 'settings-panel-appearance').hidden).toBe(true);

    byId(tree, 'settings-tab-appearance').onClick!();
    tree = ui.render();
    expect(byId(tree, 'settings-panel-general').hidden).toBe(true);
    expect(byId(tree, 'settings-panel-appearance').hidden).toBe(false);
  });

  // Most fields save the moment they change, so Save only appears when a field that waits for it
  // has an unsaved change -- and then outside the tabs, so it is reachable from any of them.
  it('shows Save only while a field that waits for it has an unsaved change', () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    const ui = harness(seeded());

    expect(saveButton(ui.render())).toBeUndefined();

    dirtyDraft(ui.render());
    const tree = ui.render();
    const save = saveButton(tree);
    expect(save).toBeDefined();
    expect(control(elementById(tree, 'settings-panel-advanced'), (element) => element === save)).toBeUndefined();
  });

  // "One copy at a time" is about launching the app, not about privacy, so it lives in General.
  it('puts the single-instance switch in General', () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    const tree = harness(defaultSettings()).render();
    const isSwitch = (element: ReactElement<ControlProps>) =>
      element.type === 'span' && element.props.children === t('settings.singleInstance', 'en');
    expect(control(elementById(tree, 'settings-panel-general'), isSwitch)).toBeDefined();
    expect(control(elementById(tree, 'settings-panel-privacy'), isSwitch)).toBeUndefined();
  });

  // The long durable-snapshot note is read in four separate paragraphs, in every language.
  it.each(['en', 'zh-TW', 'ja', 'de'] as const)('splits the durable snapshot note into paragraphs in %s', (locale) => {
    expect(t('settings.durableSnapshotsDescription', locale).split('\n\n')).toHaveLength(4);
  });

  it('drops the custom actions tab when the section is hidden', () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    const withActions = tabIds(harness(defaultSettings()).render());
    const redacted = tabIds(
      harness({ ...defaultSettings(), snapshotPersistence: true, snapshotRedactionTier: 'hashes' }).render(),
    );

    expect(withActions).toContain('settings-tab-customActions');
    expect(redacted).not.toContain('settings-tab-customActions');
    expect(redacted).toHaveLength(withActions.length - 1);
  });
});

describe('SettingsModal standby save ordering', () => {
  it('persists a standby change at once, without Save, and leaves every pane as it was', async () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    const write = vi.spyOn(host.settings, 'set').mockResolvedValue(undefined);
    const initial = defaultSettings();
    const ui = harness(initial);

    control(ui.render(), (element) => element.type === 'select' && element.props.value === 'meta')!
      .props.onChange!({ target: { value: 'grok' } });

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const persisted = write.mock.calls[0][0] as AppSettings;
    expect(persisted.standbyProvider).toBe('grok');
    expect(persisted.presentation).toEqual(initial.presentation);
    expect(persisted.openProviders).toEqual(initial.openProviders);
  });

  it('restores only the collaboration roles to their defaults, at once and without Save', async () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    const write = vi.spyOn(host.settings, 'set').mockResolvedValue(undefined);
    const initial = defaultSettings();
    const edited: AppSettings = {
      ...initial,
      adapterBaseUrl: SEED_URL,
      modeRoles: { ...initial.modeRoles, debate: { ...initial.modeRoles.debate, judge: 'meta' } },
    };
    const ui = harness(edited);

    const label = `${t('settings.restoreDefaults', 'en')}: ${t('settings.modeRoles', 'en')}`;
    control(ui.render(), (element) => element.type === 'button' && (element.props as { 'aria-label'?: string })['aria-label'] === label)!
      .props.onClick!();

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const persisted = write.mock.calls[0][0] as AppSettings;
    expect(persisted.modeRoles).toEqual(initial.modeRoles);
    // A roles reset is not a general reset: other fields keep their values.
    expect(persisted.adapterBaseUrl).toBe(SEED_URL);
  });

  it('coalesces Save clicks and keeps the modal open while a save is in flight', async () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    let finishSwap!: () => void;
    const write = vi.spyOn(host.settings, 'set').mockReturnValue(new Promise<void>((resolve) => { finishSwap = resolve; }));
    const ui = harness(seeded());
    dirtyDraft(ui.render());
    const tree = ui.render();
    const save = control(tree, (element) => element.type === 'button' && element.props.children === t('settings.save', 'en'))!
      .props.onClick!;
    save();
    save();
    await control(tree, (element) => element.type === 'button' && element.props.children === t('settings.close', 'en'))!
      .props.onClick!();
    expect(ui.onClose).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    finishSwap();
    await vi.waitFor(() => expect(ui.onSaved).toHaveBeenCalledTimes(1));
    expect(write).toHaveBeenCalledTimes(1);
    await control(ui.render(), (element) => element.type === 'button' && element.props.children === t('settings.close', 'en'))!
      .props.onClick!();
    expect(ui.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps a saved draft through an autosave queued before the parent renders', async () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    let finishSwap!: () => void;
    const swap = new Promise<void>((resolve) => { finishSwap = resolve; });
    const write = vi.spyOn(host.settings, 'set').mockResolvedValue(undefined).mockReturnValueOnce(swap);
    const ui = harness(seeded());

    dirtyDraft(ui.render());
    const tree = ui.render();
    control(tree, (element) => element.type === 'button' && element.props.children === t('settings.save', 'en'))!
      .props.onClick!();
    control(tree, (element) => element.type === 'select' && element.props.value === 'system')!
      .props.onChange!({ target: { value: 'ja' } });

    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    finishSwap();
    await vi.waitFor(() => expect(ui.onSaved).toHaveBeenCalledTimes(2));
    const persisted = write.mock.calls.map(([settings]) => settings as AppSettings);
    expect(persisted.map((settings) => settings.adapterBaseUrl)).toEqual([NEXT_URL, NEXT_URL]);
    expect(persisted[1].language).toBe('ja');
  });

  it('does not finish closing if Save starts while the font-size flush is pending', async () => {
    vi.stubGlobal('window', { setTimeout: vi.fn(), clearTimeout: vi.fn() });
    let finishFont!: () => void;
    let finishSwap!: () => void;
    const font = new Promise<void>((resolve) => { finishFont = resolve; });
    const swap = new Promise<void>((resolve) => { finishSwap = resolve; });
    const write = vi.spyOn(host.settings, 'set').mockReturnValueOnce(font).mockReturnValueOnce(swap);
    const ui = harness(seeded());
    dirtyDraft(ui.render());
    // This repo renders the box through FontSizeField, which a shallow walk does not expand; its
    // onText/onCommit pair is exactly what the input's onChange calls.
    const fontField = control(ui.render(), (element) => (element.props as { field?: string }).field === 'fontSize')!
      .props as unknown as { value: number; onText: (text: string) => void; onCommit: (value: number) => void };
    expect(fontField.value).toBe(DEFAULT_FONT_SIZE);
    fontField.onText(String(DEFAULT_FONT_SIZE + 2));
    fontField.onCommit(DEFAULT_FONT_SIZE + 2);
    const tree = ui.render();
    const close = control(tree, (element) => element.type === 'button' && element.props.children === t('settings.close', 'en'))!
      .props.onClick!();
    control(tree, (element) => element.type === 'button' && element.props.children === t('settings.save', 'en'))!
      .props.onClick!();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    finishFont();
    await close;
    expect(ui.onClose).not.toHaveBeenCalled();
    finishSwap();
    await vi.waitFor(() => expect(ui.onSaved).toHaveBeenCalledTimes(2));
  });
});
