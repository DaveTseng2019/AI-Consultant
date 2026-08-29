import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../ui/settingsModel';

const SCRIPT = 'C:\\Users\\me\\archive.ps1';

describe('custom toolbar actions', () => {
  // Losing this migration would take away a button the user had already configured, silently: the
  // settings screen would come up empty and the toolbar would simply have one button fewer.
  it('carries a settings.json written before the list into one action', () => {
    const migrated = normalizeSettings({ archiveScript: SCRIPT, archiveLabel: 'Archive', archiveConfirm: false });

    expect(migrated.customActions).toEqual([
      { id: 'archive', name: 'Archive', script: SCRIPT, note: '', payload: 'run', confirm: false },
    ]);
  });

  it('leaves the list alone once there is one, legacy fields or not', () => {
    const stored = [
      { id: 'mine', name: 'Mine', script: SCRIPT, note: 'runs a thing', payload: 'markdown' as const, confirm: true },
    ];

    expect(normalizeSettings({ customActions: stored, archiveScript: SCRIPT }).customActions).toEqual(stored);
  });

  it('has nothing to migrate when no script was ever configured', () => {
    expect(normalizeSettings({}).customActions).toEqual([]);
    expect(normalizeSettings({ archiveScript: '   ' }).customActions).toEqual([]);
  });

  // An entry with no script is a button that can only fail, and an id is what the run command looks
  // the script up by -- an entry that lost its id has to get one rather than become unclickable.
  it('drops entries with no script and names the ones with no id', () => {
    const normalized = normalizeSettings({
      customActions: [{ name: 'no script' }, { script: SCRIPT, name: 'no id' }],
    });

    expect(normalized.customActions).toHaveLength(1);
    expect(normalized.customActions[0].id).not.toBe('');
    expect(normalized.customActions[0].script).toBe(SCRIPT);
  });

  // The defaults match the single button this list replaced: it always passed the run, and it
  // always asked first.
  it('defaults to the run and to asking, for an entry that does not say', () => {
    const [action] = normalizeSettings({ customActions: [{ id: 'a', script: SCRIPT }] }).customActions;

    expect(action.payload).toBe('run');
    expect(action.confirm).toBe(true);
  });

  // The list stored a boolean before it grew a third choice, and a settings.json written in between
  // still says passRun. Reading it as "run"/"none" keeps those buttons working.
  it('reads the boolean the first version of the list stored', () => {
    const fromBoolean = (passRun: boolean) =>
      normalizeSettings({ customActions: [{ id: 'a', script: SCRIPT, passRun }] }).customActions[0].payload;

    expect(fromBoolean(true)).toBe('run');
    expect(fromBoolean(false)).toBe('none');
  });
});
