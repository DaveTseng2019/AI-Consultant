import { describe, expect, it } from 'vitest';
import { normalizeLinearTables } from '../ui/linearTables';

const headers = { key: '項目', value: '內容' };
const normalize = (text: string) => normalizeLinearTables(text, headers);

describe('linear text tables', () => {
  // The transcripts people paste in carry the table as a drawing. A drawing is unreadable once the
  // font is no longer monospaced, which is exactly what an exported .html is read in, so the rows
  // have to become rows again before the export renders them.
  it('turns a box-drawn table back into rows', () => {
    const drawn = [
      '┌────────┬──────┐',
      '│ commit │ 日期 │',
      '├────────┼──────┤',
      '│ 8a0d39 │ 09-1 │',
      '│ 0      │ 6    │',
      '└────────┴──────┘',
    ].join('\n');

    expect(normalize(drawn)).toBe(
      ['| commit | 日期 |', '| --- | --- |', '| 8a0d390 | 09-16 |'].join('\n'),
    );
  });

  // A cell that ran out of room mid-word is continued with no space, and one that stopped before a
  // word that would not fit keeps the space that the wrap ate. The drawing itself is the only
  // evidence of which happened: a piece that fills its column was cut, a shorter one was wrapped.
  it('rejoins a wrapped cell the way the column width says it was broken', () => {
    const drawn = [
      '┌──────────┬──────────────────┐',
      '│ repo     │ 結果             │',
      '├──────────┼──────────────────┤',
      '│ SillyTav │ 641 passed /     │',
      '│ ern      │ 1 ignored        │',
      '└──────────┴──────────────────┘',
    ].join('\n');

    expect(normalize(drawn)).toContain('| SillyTavern | 641 passed / 1 ignored |');
  });

  it('leaves a code fence alone, drawing and all', () => {
    const fenced = ['```', '┌───┬───┐', '│ a │ b │', '└───┴───┘', '```'].join('\n');

    expect(normalize(fenced)).toBe(fenced);
  });

  it('splits a markdown table that arrived flattened onto one line', () => {
    const flat = '| 項目 | 值 | | --- | --- | | A | 1 | | B | 2 |';

    expect(normalize(flat)).toBe(
      ['| 項目 | 值 |', '| --- | --- |', '| A | 1 |', '| B | 2 |'].join('\n'),
    );
  });

  it('leaves a table that already has its own lines untouched', () => {
    const table = ['| 項目 | 值 |', '| --- | --- |', '| A | 1 |'].join('\n');

    expect(normalize(table)).toBe(table);
  });

  it('turns a standalone run of "key: value" lines into two columns', () => {
    const run = ['brands: Edge 153', 'ua: Chrome/153', ''].join('\n');

    expect(normalize(run)).toBe(
      ['| 項目 | 內容 |', '| --- | --- |', '| brands | Edge 153 |', '| ua | Chrome/153 |', ''].join('\n'),
    );
  });

  // Prose right below the run usually IS the last value, wrapped. Converting then tears that line
  // off and strands it under a table, which is worse than leaving the run as the text it already is.
  it('leaves a "key: value" run that runs straight into prose', () => {
    const run = ['記憶: fork-upstream-check', '動作: 更新', '這一段是接續上一行的說明。'].join('\n');

    expect(normalize(run)).toBe(run);
  });

  // A bare URL is not a key and a value, and neither is a numbered instruction that happens to
  // explain itself after a colon.
  it('leaves URLs and numbered steps alone', () => {
    const lines = ['https://example.com/a', 'https://example.com/b', ''].join('\n');
    const steps = ['4. 勾這一項: MSVC v145', '5. 按修改: 等它裝完', ''].join('\n');

    expect(normalize(lines)).toBe(lines);
    expect(normalize(steps)).toBe(steps);
  });
});
