// A table that reaches the app as running text instead of as rows. Three shapes turn up often
// enough to be worth repairing before an export renders them:
//   1. a box-drawn table, the shape a terminal or a CLI transcript carries: ┌─┬─┐ │ a │ b │ └─┴─┘;
//   2. a markdown table flattened onto one line, because the answer was copied out of a pane that
//      dropped the newlines: "| A | B | | --- | --- | | 1 | 2 |";
//   3. a run of "key: value" lines, which is a two-column table written as prose.
// All three are rewritten into ordinary markdown table syntax, so the one table renderer the app
// already has produces the <table>.

const DELIMITER_CELL = /^:?-{3,}:?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// notes: a heuristic, not a parser. A "key: value" run of two lines becomes a table even when the
//        author meant prose, and a key longer than the 30 characters below is left alone even when
//        it was a row. Upgrade path: only convert when the provider's own DOM said it was a table
//        (the injected serializer already sees that) and drop this pass.
// A half-width colon must be followed by a space, so a bare "https://..." line is not read as a key
// and a value; a full-width colon is written without the space and needs no such proof.
const COLON_LINE = /^[\t ]*(?:[-*•][\t ]+)?([^|:：#>(（[][^|:：]{0,29}?)[\t ]*(?::[\t ]+|：[\t ]*)(.+?)[\t ]*$/;

export interface LinearTableHeaders {
  key: string;
  value: string;
}

export function normalizeLinearTables(text: string, headers: LinearTableHeaders): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let fence: string | null = null;

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    const fenceMatch = line.match(FENCE);
    if (fence) {
      output.push(line);
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      output.push(line);
      continue;
    }

    const boxed = readBoxTable(lines, cursor);
    if (boxed) {
      output.push(...boxed.table);
      cursor = boxed.nextCursor - 1;
      continue;
    }

    const flattened = expandFlattenedTable(line);
    if (flattened) {
      output.push(...flattened);
      continue;
    }

    const pairs = readColonRun(lines, cursor);
    if (pairs) {
      output.push(`| ${escapeCell(headers.key)} | ${escapeCell(headers.value)} |`, '| --- | --- |');
      for (const pair of pairs.rows) output.push(`| ${escapeCell(pair[0])} | ${escapeCell(pair[1])} |`);
      cursor = pairs.nextCursor - 1;
      continue;
    }

    output.push(line);
  }

  return output.join('\n');
}

const BOX_TOP = /^[\t ]*[┌┏╔╭][─━═┬┳╦╮┐┓╗╭╴-]*[┐┓╗╮][\t ]*$/;
const BOX_BOTTOM = /^[\t ]*[└┗╚╰][─━═┴┻╩╯┘┛╝╰╴-]*[┘┛╝╯][\t ]*$/;
const BOX_SEPARATOR = /^[\t ]*[├┣╠][─━═┼╋╬┬┴╴-]*[┤┫╣][\t ]*$/;
const BOX_ROW = /^[\t ]*[│┃║].*[│┃║][\t ]*$/;
const BOX_VERTICAL = /[│┃║]/;

/**
 * The box-drawn form: the top border through the bottom border, rewritten as a markdown table. The
 * first block of lines is the header, and every block between two ├───┤ separators is one row.
 */
function readBoxTable(lines: readonly string[], cursor: number): { table: string[]; nextCursor: number } | null {
  if (!BOX_TOP.test(lines[cursor])) return null;
  const widths = borderWidths(lines[cursor]);
  if (widths.length < 2) return null;

  const blocks: string[][][] = [];
  let block: string[][] = [];
  let next = cursor + 1;
  let closed = false;

  while (next < lines.length) {
    const line = lines[next];
    next += 1;
    if (BOX_BOTTOM.test(line)) {
      closed = true;
      break;
    }
    if (BOX_SEPARATOR.test(line)) {
      if (block.length > 0) blocks.push(block);
      block = [];
      continue;
    }
    if (!BOX_ROW.test(line)) return null;
    const cells = line.trim().split(BOX_VERTICAL).slice(1, -1);
    if (cells.length !== widths.length) return null;
    block.push(cells);
  }

  if (!closed) return null;
  if (block.length > 0) blocks.push(block);
  if (blocks.length === 0) return null;

  const rows = blocks.map((lines) => joinWrappedRow(lines, widths));
  const header = rows[0];
  const table = [row(header.map(escapeCell)), row(header.map(() => '---'))];
  for (const cells of rows.slice(1)) table.push(row(cells.map(escapeCell)));
  return { table, nextCursor: next };
}

/** `[10, 6, 49]`: how wide each column is drawn, counted in terminal cells. */
function borderWidths(border: string): number[] {
  return border
    .trim()
    .slice(1, -1)
    .split(/[┬┳╦┼╋╬┴┻╩]/)
    .map((segment) => segment.length);
}

// One row is drawn over several lines whenever a cell was too long for its column. Whether the two
// pieces need a space between them is not recorded anywhere, so it is read back from the drawing: a
// piece that fills its column was cut mid-word and joins with nothing, a shorter one ran out of room
// before the next word and joins with a space.
// notes: a column exactly as wide as the text it holds is indistinguishable from a cut, so a table
//        whose column happens to fit its longest word exactly can lose one space. No upgrade path
//        short of the producer emitting the table as data rather than as a drawing.
function joinWrappedRow(lines: readonly string[][], widths: readonly number[]): string[] {
  return widths.map((width, column) => {
    let cell = '';
    let previousFilledTheColumn = false;
    for (const line of lines) {
      const piece = line[column].trim();
      if (piece === '') continue;
      if (cell !== '' && !previousFilledTheColumn) cell += ' ';
      cell += piece;
      previousFilledTheColumn = displayWidth(piece) >= width - 2;
    }
    return cell;
  });
}

// Terminal cells, not characters: a CJK glyph is drawn two columns wide, which is what the border
// above was measured in.
function displayWidth(value: string): number {
  let width = 0;
  for (const character of value) {
    width += /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(character) ? 2 : 1;
  }
  return width;
}

/** The one-line form, or null when the line is not one. */
function expandFlattenedTable(line: string): string[] | null {
  if (!line.includes('|')) return null;
  // Empty cells are dropped: in the flattened form the "| |" between two rows is where the newline
  // used to be, not a column, and there is no way to tell it from a cell that was empty to begin
  // with once the rows are on one line.
  const cells = splitCells(line).filter((cell) => cell !== '');
  const delimiterStart = cells.findIndex((cell) => DELIMITER_CELL.test(cell));
  // The header is everything before the delimiter run, so a table that already sits on its own line
  // (delimiter row alone, or a header row alone) has nothing to expand and is left untouched.
  if (delimiterStart <= 0) return null;

  const columns = delimiterStart;
  const delimiters = cells.slice(delimiterStart, delimiterStart + columns);
  if (delimiters.length !== columns || !delimiters.every((cell) => DELIMITER_CELL.test(cell))) return null;

  const rows = cells.slice(delimiterStart + columns);
  if (rows.length === 0) return null;

  const table = [row(cells.slice(0, columns)), row(delimiters)];
  for (let index = 0; index < rows.length; index += columns) {
    const cursorRow = rows.slice(index, index + columns);
    while (cursorRow.length < columns) cursorRow.push('');
    table.push(row(cursorRow));
  }
  return table;
}

/** The "key: value" form: at least two of them in a row, or nothing. */
function readColonRun(lines: readonly string[], cursor: number): { rows: string[][]; nextCursor: number } | null {
  const indent = leadingSpaces(lines[cursor]);
  const rows: string[][] = [];
  let next = cursor;
  while (next < lines.length && leadingSpaces(lines[next]) === indent) {
    const match = lines[next].match(COLON_LINE);
    const key = match?.[1].trim() ?? '';
    if (!match || key.length === 0 || /^\d+[.)]/.test(key)) break;
    rows.push([key, match[2].trim()]);
    next += 1;
  }
  if (rows.length < 2) return null;
  // The run has to stand on its own. Prose on the very next line usually means the last value was
  // simply wrapped onto it, and converting then tears that continuation off and strands it under
  // the table -- worse than leaving the whole run as the text it already is.
  if ((lines[next] ?? '').trim() !== '') return null;
  return { rows, nextCursor: next };
}

function leadingSpaces(line: string): number {
  return (line.match(/^[\t ]*/) ?? [''])[0].length;
}

function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  const source = line.trim();
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\\' && source[index + 1] === '|') {
      cell += '\\|';
      index += 1;
    } else if (source[index] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += source[index];
    }
  }
  cells.push(cell.trim());
  // A pipe at either end opens an empty cell that is punctuation, not a column.
  if (cells[0] === '') cells.shift();
  if (cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}
