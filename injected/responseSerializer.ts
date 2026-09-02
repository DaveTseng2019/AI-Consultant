const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const BLOCK_TAGS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'HEADER',
  'MAIN',
  'NAV',
  'P',
  'SECTION',
]);
const OMITTED_TAGS = new Set(['BUTTON', 'NOSCRIPT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE']);
// Text that exists only for assistive tech is not part of the answer. Claude repeats the label of
// every tool pill ("Searched the web") in an sr-only span beside the button this list already
// drops, and that copy was arriving as the first line of the captured answer. The span carries no
// aria-hidden -- it is the accessible name -- so the class is the only handle on it.
const SCREEN_READER_ONLY_CLASSES = new Set(['sr-only', 'visually-hidden']);
const TABLE_SECTION_TAGS = new Set(['TBODY', 'TFOOT', 'THEAD']);

interface SerializationContext {
  protectedBlocks: string[];
}

// The finish-time DOM read is authoritative even when the provider revised or shortened its
// answer. The streamed cache is only a fallback when the current response node disappeared.
export function finalResponseText(cached: string, fresh: string | null): string {
  return fresh ?? cached;
}

export function serializeResponseText(root: Element): string {
  const context: SerializationContext = { protectedBlocks: [] };
  const serialized = normalizeDocument(serializeNode(root, context));
  // A replacer function, not a replacement string: $&, $', $` and $$ inside a code block are
  // expanded by String.replace substitution rules and would rewrite the block with other content.
  return context.protectedBlocks.reduce(
    (text, block, index) => text.replace(protectedToken(index), () => block),
    serialized,
  );
}

function serializeNode(node: Node, context: SerializationContext): string {
  if (node.nodeType === TEXT_NODE) return normalizeText(node.textContent ?? '');
  const element = node as Element;
  if (node.nodeType !== ELEMENT_NODE && node.nodeType !== undefined) return '';
  if (typeof element.tagName !== 'string') return '';
  if (
    OMITTED_TAGS.has(tagName(element)) ||
    attribute(element, 'aria-hidden') === 'true' ||
    classList(element).some((name) => SCREEN_READER_ONLY_CLASSES.has(name))
  ) {
    return '';
  }
  if (!element.childNodes) return normalizeText(element.textContent ?? '');

  const tag = tagName(element);
  if (isMathRoot(element, tag)) return mathText(element, tag);
  if (tag === 'BR') return '\n';
  if (tag === 'HR') return block('---');
  if (isRenderedDiagram(element, tag)) return block(protectRenderedMermaid(element, context));
  if (tag === 'PRE') return block(protectCodeBlock(element, context));
  if (tag === 'TABLE') return block(tableToMarkdown(element));
  if (tag === 'UL' || tag === 'OL') return block(serializeList(element, tag === 'OL', context, 0));
  if (tag === 'BLOCKQUOTE') return block(serializeBlockquote(element, context));
  if (/^H[1-6]$/.test(tag)) {
    const content = serializeChildren(element, context).trim();
    return content ? block(`${'#'.repeat(Number(tag[1]))} ${content}`) : '';
  }

  const content = serializeChildren(element, context);
  if (tag === 'STRONG' || tag === 'B') return wrapInline(content, '**');
  if (tag === 'EM' || tag === 'I') return wrapInline(content, '*');
  if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return wrapInline(content, '~~');
  if (tag === 'CODE') return inlineCode(element.textContent ?? content);
  if (tag === 'A') return serializeLink(element, content);
  if (tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO') return '';
  if (tag === 'LI') return block(content);
  return BLOCK_TAGS.has(tag) ? block(content) : content;
}

// KaTeX and MathJax mark the rendered glyphs aria-hidden, so the generic aria-hidden drop above
// erases a whole formula and leaves "約 / 分鐘". Rebuild it from the MathML <annotation> that
// carries the original TeX, and fall back to the rendered glyphs when the markup has no MathML.
function isMathRoot(element: Element, tag: string): boolean {
  if (tag === 'MATH' || tag === 'MJX-CONTAINER') return true;
  const classes = classList(element);
  return classes.includes('katex') || classes.includes('katex-display');
}

function mathText(element: Element, tag: string): string {
  const tex = texAnnotation(element)?.trim();
  if (tex) {
    const display =
      classList(element).includes('katex-display') ||
      (tag === 'MJX-CONTAINER' && attribute(element, 'display') === 'true');
    return display ? block('$$' + tex + '$$') : '$' + tex + '$';
  }
  // notes: without a TeX source we keep the rendered characters, which doubles a formula that
  //        ships MathML and glyphs side by side. Narrow to the MathML subtree if that turns up.
  return normalizeText(element.textContent ?? '').trim();
}

function texAnnotation(element: Element): string | null {
  if (tagName(element) === 'ANNOTATION' && attribute(element, 'encoding') === 'application/x-tex') {
    return element.textContent ?? '';
  }
  for (const child of directChildElements(element)) {
    const found = texAnnotation(child);
    if (found !== null) return found;
  }
  return null;
}

function classList(element: Element): string[] {
  return (attribute(element, 'class') ?? '').split(' ');
}

function serializeChildren(element: Element, context: SerializationContext): string {
  let output = '';
  for (const child of Array.from(element.childNodes ?? [])) output += serializeNode(child, context);
  return output;
}

function serializeBlockquote(element: Element, context: SerializationContext): string {
  const content = normalizeDocument(serializeChildren(element, context));
  if (!content) return '';
  return content
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

function serializeList(element: Element, ordered: boolean, context: SerializationContext, depth: number): string {
  const items = directChildElements(element).filter((child) => tagName(child) === 'LI');
  return items
    .map((item, index) => serializeListItem(item, ordered ? `${index + 1}.` : '-', context, depth))
    .filter(Boolean)
    .join('\n');
}

function serializeListItem(item: Element, marker: string, context: SerializationContext, depth: number): string {
  let content = '';
  const nested: string[] = [];
  for (const child of Array.from(item.childNodes ?? [])) {
    if (child.nodeType === ELEMENT_NODE) {
      const childElement = child as Element;
      const childTag = tagName(childElement);
      if (childTag === 'UL' || childTag === 'OL') {
        const nestedList = serializeList(childElement, childTag === 'OL', context, depth + 1);
        if (nestedList) nested.push(nestedList);
        continue;
      }
    }
    content += serializeNode(child, context);
  }

  const indent = '  '.repeat(depth);
  const continuationIndent = `${indent}${' '.repeat(marker.length + 1)}`;
  const lines = normalizeDocument(content).split('\n').filter((line, index, all) => line || (index > 0 && index < all.length - 1));
  const first = lines.shift() ?? '';
  const output = [`${indent}${marker}${first ? ` ${first}` : ''}`];
  output.push(...lines.map((line) => `${continuationIndent}${line}`));
  output.push(...nested);
  return output.join('\n');
}

function tableToMarkdown(table: Element): string {
  const rows = tableRows(table)
    .map((row) => directChildElements(row).filter((cell) => ['TH', 'TD'].includes(tagName(cell))).map(tableCellText))
    .filter((row) => row.length > 0);
  if (rows.length === 0) return '';

  const width = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => '')]);
  const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
  const [header, ...body] = normalizedRows;
  return [line(header), line(Array.from({ length: width }, () => '---')), ...body.map(line)].join('\n');
}

function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  const visit = (container: Element) => {
    for (const child of directChildElements(container)) {
      const tag = tagName(child);
      if (tag === 'TR') rows.push(child);
      else if (TABLE_SECTION_TAGS.has(tag)) visit(child);
    }
  };
  visit(table);
  return rows;
}

function tableCellText(cell: Element): string {
  const text = serializeTableCellChildren(cell).replace(/\s+/g, ' ').trim();
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function serializeTableCellChildren(element: Element): string {
  let output = '';
  for (const child of Array.from(element.childNodes ?? [])) {
    if (child.nodeType === TEXT_NODE) {
      output += child.textContent ?? '';
      continue;
    }
    const childElement = child as Element;
    if (child.nodeType !== ELEMENT_NODE || typeof childElement.tagName !== 'string') continue;
    const tag = tagName(childElement);
    if (OMITTED_TAGS.has(tag)) continue;
    if (tag === 'BR') output += ' ';
    else output += ` ${serializeTableCellChildren(childElement)} `;
  }
  return output;
}

function protectCodeBlock(element: Element, context: SerializationContext): string {
  // A block the provider renders as a picture holds no <code>, so the fallback below would fence
  // the surrounding chrome instead: ChatGPT's mermaid block is an <img> plus a menu button, and
  // every diagram in an export came out as the button's own label ("Diagram options").
  const diagram = renderedDiagram(element);
  if (diagram && !diagram.code) return '';
  const codeElement = firstDescendantByTag(element, 'CODE');
  const code = (diagram?.code ?? preformattedText(codeElement ?? element)).replace(/\r\n?/g, '\n');
  const language = (diagram ? diagram.language : codeLanguage(codeElement ?? element)) || mermaidLanguage(code);
  return protectFence(code, language, context);
}

// Grok draws a diagram directly into the answer with no <pre> and no <code>: the block is a
// container div holding an SVG, and OMITTED_TAGS drops that SVG, so every Grok diagram reached the
// export as nothing at all -- not even an empty fence.
const MERMAID_CONTAINER_CLASS = 'mermaid';
const MERMAID_MARKER_ATTRIBUTE = 'data-mermaid';

// Claude marks both forms of a diagram with the same attribute: a <pre> that still holds its source
// (which is what a block that failed to render leaves behind), and a <div> whose SVG lives in a
// shadow root once it has rendered. Only the second one needs the source dug out, so a <pre> is
// left to the code-block path that can simply read it.
function isRenderedDiagram(element: Element, tag: string): boolean {
  if (tag === 'PRE') return false;
  return (
    classList(element).includes(MERMAID_CONTAINER_CLASS) ||
    attribute(element, MERMAID_MARKER_ATTRIBUTE) === 'true'
  );
}

function protectRenderedMermaid(element: Element, context: SerializationContext): string {
  const code = reactFiberMermaidSource(element).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return code ? protectFence(code, MERMAID_CONTAINER_CLASS, context) : '';
}

function protectFence(code: string, language: string, context: SerializationContext): string {
  const longestFence = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestFence + 1));
  const blockText = `${fence}${language ? language : ''}\n${code}${code.endsWith('\n') ? '' : '\n'}${fence}`;
  const index = context.protectedBlocks.push(blockText) - 1;
  return protectedToken(index);
}

interface ReactFiber {
  memoizedProps?: unknown;
  pendingProps?: unknown;
  return?: ReactFiber;
}

// notes: reads React's own `__reactFiber$<id>` expando and climbs it, which is private and
//        unversioned -- the provider can rename it or move the source to another ancestor, and the
//        diagram is then dropped, exactly as it is dropped today. Nothing in the DOM holds the
//        source: the container has only the rendered SVG. Prefer a DOM attribute if one appears.
//        The opening keyword is what identifies the right prop, so no prop name is hard-coded.
function reactFiberMermaidSource(node: Element): string {
  try {
    const fiberKey = Object.keys(node).find((name) => name.startsWith('__reactFiber$'));
    if (!fiberKey) return '';
    let fiber = (node as unknown as Record<string, ReactFiber | undefined>)[fiberKey];
    for (let depth = 0; depth < 8 && fiber; depth += 1) {
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        if (typeof props !== 'object' || props === null) continue;
        for (const value of Object.values(props)) {
          if (typeof value === 'string' && mermaidLanguage(value)) return value;
        }
      }
      fiber = fiber.return;
    }
    return '';
  } catch {
    return '';
  }
}

// Every keyword Mermaid accepts as the opening word of a diagram. A block that starts with one of
// these is Mermaid whatever the provider called it, which is what makes the guess below safe.
const MERMAID_OPENING_KEYWORDS =
  /^(architecture|block|packet|radar|sankey|xychart)-beta\b|^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|kanban|zenuml|C4Context)\b/;

// Gemini publishes no language at all: the <code> carries none, the header reads "Code snippet"
// rather than the language, and nothing in the block's subtree names it -- it survives only inside
// Angular's component state. Reading the first line back is smaller and steadier than reaching for
// a framework's internals, and a block opening with "flowchart TD" is Mermaid beyond doubt.
// notes: recognises Mermaid only. Any other unlabelled language still exports as a bare fence,
//        which renders as plain code -- the same as before, never worse.
function mermaidLanguage(code: string): string {
  const firstLine = code.split('\n').find((line) => line.trim().length > 0) ?? '';
  return MERMAID_OPENING_KEYWORDS.test(firstLine.trim()) ? 'mermaid' : '';
}

// The pane that replaces a code block with its rendered picture. The attribute value is the
// language, which is the only part of the block still readable from the DOM.
const RENDERED_PANE_ATTRIBUTE = 'data-code-block-preview-pane';

interface RenderedDiagram {
  language: string;
  code: string;
}

// An empty `code` means the pane was found but its source could not be read, which drops the block
// rather than fencing the button label that reading the DOM would otherwise produce.
function renderedDiagram(element: Element): RenderedDiagram | undefined {
  const pane = firstDescendantByAttribute(element, RENDERED_PANE_ATTRIBUTE);
  if (!pane) return undefined;
  const language = attribute(pane, RENDERED_PANE_ATTRIBUTE) ?? '';
  return {
    language: /^[\w+-]+$/.test(language) ? language : '',
    code: reactSourceProp(pane).replace(/\s+$/, ''),
  };
}

// notes: reads React's own `__reactProps$<id>` expando, which is private and unversioned -- the
//        provider can rename it or reshape the props at any time, and the block is then dropped
//        instead of exported. The source is nowhere in the DOM (no text node, no alt, no title;
//        only a data: URI image), so nothing else can recover it today. Prefer a DOM attribute
//        the moment the provider exposes one.
function reactSourceProp(node: Element): string {
  try {
    const propsKey = Object.keys(node).find((name) => name.startsWith('__reactProps$'));
    if (!propsKey) return '';
    const seen = new Set<object>();
    const search = (value: unknown, depth: number): string => {
      if (typeof value !== 'object' || value === null || depth > 10 || seen.has(value)) return '';
      seen.add(value);
      for (const [name, child] of Object.entries(value)) {
        if (name === 'source' && typeof child === 'string') return child;
        const found = search(child, depth + 1);
        if (found) return found;
      }
      return '';
    };
    return search((node as unknown as Record<string, unknown>)[propsKey], 0);
  } catch {
    return '';
  }
}

// A highlighter that gives every code line its own element leaves no newline character behind,
// so textContent runs the whole block together while each line keeps its indentation. innerText
// follows the rendered layout and restores those line breaks. It is absent outside a rendered
// document, and a single-line block needs no repair, so textContent stays the fallback.
function preformattedText(element: Element): string {
  const raw = element.textContent ?? '';
  const rendered = (element as { innerText?: unknown }).innerText;
  if (typeof rendered !== 'string' || !rendered.includes('\n')) return raw;
  return raw.includes('\n') ? raw : rendered;
}

function inlineCode(value: string): string {
  const code = value.replace(/\s*\n\s*/g, ' ');
  if (!code) return '';
  const longestFence = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(Math.max(1, longestFence + 1));
  const needsPadding = /^\s|\s$|^`|`$/.test(code);
  return `${fence}${needsPadding ? ' ' : ''}${code}${needsPadding ? ' ' : ''}${fence}`;
}

function serializeLink(element: Element, content: string): string {
  const label = normalizeText(element.textContent ?? content).trim();
  const href = safeHttpUrl(attribute(element, 'href'));
  if (!label) return href ?? '';
  if (!href || label === href) return label;
  const escapedLabel = label.replace(/(\\|\[|\])/g, '\\$1');
  const escapedHref = href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
  return `[${escapedLabel}](${escapedHref})`;
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value || Array.from(value).some((character) => character.charCodeAt(0) <= 31)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function codeLanguage(element: Element): string {
  const className = attribute(element, 'class') ?? '';
  const classMatch = className.match(/(?:^|\s)language-([\w+-]+)/i);
  const candidate = classMatch?.[1] ?? attribute(element, 'data-language') ?? '';
  return /^[\w+-]+$/.test(candidate) ? candidate : '';
}

function firstDescendantByAttribute(element: Element, wantedAttribute: string): Element | undefined {
  for (const child of directChildElements(element)) {
    if (attribute(child, wantedAttribute) !== undefined) return child;
    const descendant = firstDescendantByAttribute(child, wantedAttribute);
    if (descendant) return descendant;
  }
  return undefined;
}

function firstDescendantByTag(element: Element, wantedTag: string): Element | undefined {
  for (const child of directChildElements(element)) {
    if (tagName(child) === wantedTag) return child;
    const descendant = firstDescendantByTag(child, wantedTag);
    if (descendant) return descendant;
  }
  return undefined;
}

function directChildElements(element: Element): Element[] {
  return Array.from(element.childNodes ?? []).filter(
    (child): child is Element => child.nodeType === ELEMENT_NODE && typeof (child as Element).tagName === 'string',
  );
}

function wrapInline(content: string, marker: string): string {
  const leading = content.match(/^\s*/)?.[0] ?? '';
  const trailing = content.match(/\s*$/)?.[0] ?? '';
  const core = content.slice(leading.length, content.length - trailing.length);
  return core ? `${leading}${marker}${core}${marker}${trailing}` : content;
}

function block(content: string): string {
  const normalized = content.replace(/^\n+|\n+$/g, '');
  return normalized ? `\n\n${normalized}\n\n` : '';
}

function normalizeText(value: string): string {
  return value.replace(/[\t\r\n ]+/g, ' ');
}

function normalizeDocument(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => (line.trim() ? line.replace(/[\t ]+$/g, '') : ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function attribute(element: Element, name: string): string | undefined {
  try {
    return element.getAttribute?.(name) ?? undefined;
  } catch {
    return undefined;
  }
}

function tagName(element: Element): string {
  return element.tagName.toUpperCase();
}

function protectedToken(index: number): string {
  return `\uE000MAC_PRE_${index}\uE001`;
}
