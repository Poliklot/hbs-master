import * as vscode from 'vscode';

export interface PartialInvocation {
  component: string | null;
  componentRange?: vscode.Range;
  fullRange: vscode.Range;
  hashStartOffset: number;
  hashEndOffset: number;
  isBlock: boolean;
}

export interface PartialHashPair {
  name: string;
  nameRange: vscode.Range;
  valueRange?: vscode.Range;
  fullRange: vscode.Range;
}

interface PartialParseCacheEntry {
  text: string;
  version?: number;
  invocations: PartialInvocation[];
}

const partialParseCache = new WeakMap<vscode.TextDocument, PartialParseCacheEntry>();

const PARTIAL_OPEN_RE = /\{\{~?\s*(#?)>\s*/g;

interface AstNode {
  type?: string;
  body?: AstNode[];
  children?: AstNode[];
  attributes?: AstAttribute[];
  parts?: AstNode[];
  block?: AstNode;
  program?: AstNode;
  inverse?: AstNode;
  inverseChain?: AstNode[];
  blockPrefix?: string;
  range?: [number, number];
}

interface AstAttribute {
  type?: string;
  value?: AstNode | null;
  block?: AstNode;
}

interface AstParser {
  parse(text: string): AstNode;
  locStart(node: unknown): number;
  locEnd(node: unknown): number;
}

interface AstPartialIndex {
  starts: Set<number>;
  unmatchedRanges: Array<[number, number]>;
}

let astParser: AstParser | null | undefined;

function getAstParser(): AstParser | null {
  if (astParser !== undefined) return astParser;

  try {
    const plugin = require('@poliklot/prettier-plugin-handlebars');
    const parser = plugin?.parsers?.handlebars;
    astParser = parser
      && typeof parser.parse === 'function'
      && typeof parser.locStart === 'function'
      && typeof parser.locEnd === 'function'
      ? parser
      : null;
  } catch {
    astParser = null;
  }

  return astParser ?? null;
}

function getAstPartialIndex(text: string): AstPartialIndex | null {
  const parser = getAstParser();
  if (!parser) return null;

  try {
    const ast = parser.parse(text);
    const starts = new Set<number>();
    const unmatchedRanges: Array<[number, number]> = [];
    const visit = (node: AstNode | null | undefined) => {
      if (!node) return;

      if (node.type === 'PartialStatement' || (node.type === 'BlockStatement' && node.blockPrefix === '#>')) {
        const start = parser.locStart(node);
        if (Number.isInteger(start) && start >= 0) starts.add(start);
      }

      if (node.type === 'UnmatchedNode') {
        const start = parser.locStart(node);
        const end = parser.locEnd(node);
        if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
          unmatchedRanges.push([start, end]);
        }
      }

      node.body?.forEach(visit);
      node.children?.forEach(visit);
      node.parts?.forEach(visit);
      node.attributes?.forEach(attribute => {
        visit(attribute.value);
        visit(attribute.block);
      });
      visit(node.block);
      visit(node.program);
      visit(node.inverse);
      node.inverseChain?.forEach(visit);
    };

    visit(ast);
    return { starts, unmatchedRanges };
  } catch {
    return null;
  }
}

function findClosingMustache(text: string, startOffset: number): number {
  let quote: string | null = null;

  for (let i = startOffset; i < text.length - 1; i++) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === '}' && text[i + 1] === '}') {
      return i + 2;
    }
  }

  return -1;
}

function skipWhitespace(text: string, offset: number, endOffset: number): number {
  while (offset < endOffset && /\s/.test(text[offset])) offset++;
  return offset;
}

function readQuoted(text: string, quoteStart: number, quote: string, endOffset: number): number {
  for (let i = quoteStart + 1; i < endOffset; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === quote) return i + 1;
  }

  return endOffset;
}

function readBalanced(text: string, startOffset: number, endOffset: number): number {
  const open = text[startOffset];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : '';
  if (!close) return startOffset;

  let quote: string | null = null;
  let balance = 0;

  for (let i = startOffset; i < endOffset; i++) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === open) balance++;
    if (ch === close) {
      balance--;
      if (balance === 0) return i + 1;
    }
  }

  return endOffset;
}

function readBareToken(text: string, startOffset: number, endOffset: number): number {
  let i = startOffset;
  while (i < endOffset && !/\s/.test(text[i]) && text[i] !== '~') i++;
  return i;
}

function contentEndBeforeClosingMustache(text: string, closeStartOffset: number): number {
  return text[closeStartOffset - 1] === '~' ? closeStartOffset - 1 : closeStartOffset;
}

function toRange(document: vscode.TextDocument, startOffset: number, endOffset: number): vscode.Range {
  return new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset));
}

function scanPartialInvocations(document: vscode.TextDocument): PartialInvocation[] {
  const text = document.getText();
  const invocations: PartialInvocation[] = [];

  PARTIAL_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = PARTIAL_OPEN_RE.exec(text))) {
    const fullStartOffset = match.index;
    const closeOffset = findClosingMustache(text, PARTIAL_OPEN_RE.lastIndex);
    if (closeOffset === -1) break;

    const closeStartOffset = closeOffset - 2;
    const contentEndOffset = contentEndBeforeClosingMustache(text, closeStartOffset);
    let componentStartOffset = skipWhitespace(text, PARTIAL_OPEN_RE.lastIndex, contentEndOffset);
    let componentEndOffset = componentStartOffset;
    let component: string | null = null;
    let componentRange: vscode.Range | undefined;

    if (componentStartOffset < contentEndOffset) {
      const first = text[componentStartOffset];

      if (first === '"' || first === "'") {
        const quotedEndOffset = readQuoted(text, componentStartOffset, first, contentEndOffset);
        componentEndOffset = quotedEndOffset;

        if (quotedEndOffset <= contentEndOffset && text[quotedEndOffset - 1] === first) {
          component = text.slice(componentStartOffset + 1, quotedEndOffset - 1);
          componentRange = toRange(document, componentStartOffset + 1, quotedEndOffset - 1);
        }
      } else if (first === '(') {
        componentEndOffset = readBalanced(text, componentStartOffset, contentEndOffset);
      } else {
        componentEndOffset = readBareToken(text, componentStartOffset, contentEndOffset);
        component = text.slice(componentStartOffset, componentEndOffset);
        componentRange = toRange(document, componentStartOffset, componentEndOffset);
      }
    }

    invocations.push({
      component,
      componentRange,
      fullRange: toRange(document, fullStartOffset, closeOffset),
      hashStartOffset: componentEndOffset,
      hashEndOffset: contentEndOffset,
      isBlock: match[1] === '#',
    });

    PARTIAL_OPEN_RE.lastIndex = closeOffset;
  }

  return invocations;
}

export function findPartialInvocations(document: vscode.TextDocument): PartialInvocation[] {
  const text = document.getText();
  const version = typeof document.version === 'number' ? document.version : undefined;
  const cached = partialParseCache.get(document);

  if (cached && cached.text === text && cached.version === version) {
    return cached.invocations;
  }

  const scanned = scanPartialInvocations(document);
  const astIndex = getAstPartialIndex(text);

  if (!astIndex) {
    partialParseCache.set(document, { text, version, invocations: scanned });
    return scanned;
  }

  const invocations = scanned.filter(invocation => {
    const start = document.offsetAt(invocation.fullRange.start);
    return astIndex.starts.has(start)
      || astIndex.unmatchedRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd);
  });

  partialParseCache.set(document, { text, version, invocations });
  return invocations;
}

export function getPartialInvocationAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): PartialInvocation | undefined {
  return findPartialInvocations(document).find(invocation => invocation.fullRange.contains(position));
}

export function getHashPairs(
  document: vscode.TextDocument,
  invocation: PartialInvocation
): PartialHashPair[] {
  const text = document.getText();
  const pairs: PartialHashPair[] = [];
  let offset = invocation.hashStartOffset;
  const endOffset = invocation.hashEndOffset;

  while (offset < endOffset) {
    offset = skipWhitespace(text, offset, endOffset);
    if (offset >= endOffset) break;

    const nameMatch = text.slice(offset, endOffset).match(/^([\w-]+)\s*=/);
    if (!nameMatch) {
      const previousOffset = offset;
      if (text[offset] === '"' || text[offset] === "'") {
        offset = readQuoted(text, offset, text[offset], endOffset);
      } else if (text[offset] === '(' || text[offset] === '[' || text[offset] === '{') {
        offset = readBalanced(text, offset, endOffset);
      } else {
        offset = readBareToken(text, offset, endOffset);
      }

      // Malformed or partially typed input must never stall the extension host.
      if (offset <= previousOffset) offset = previousOffset + 1;
      continue;
    }

    const name = nameMatch[1];
    const nameStartOffset = offset;
    const nameEndOffset = nameStartOffset + name.length;
    const valueStartWithEqualsOffset = nameStartOffset + nameMatch[0].length;
    const valueStartOffset = skipWhitespace(text, valueStartWithEqualsOffset, endOffset);
    let valueEndOffset = valueStartOffset;

    if (valueStartOffset < endOffset) {
      const first = text[valueStartOffset];
      if (first === '"' || first === "'") {
        valueEndOffset = readQuoted(text, valueStartOffset, first, endOffset);
      } else if (first === '(' || first === '[' || first === '{') {
        valueEndOffset = readBalanced(text, valueStartOffset, endOffset);
      } else {
        valueEndOffset = readBareToken(text, valueStartOffset, endOffset);
      }
    }

    pairs.push({
      name,
      nameRange: toRange(document, nameStartOffset, nameEndOffset),
      valueRange: valueEndOffset > valueStartOffset
        ? toRange(document, valueStartOffset, valueEndOffset)
        : undefined,
      fullRange: toRange(document, nameStartOffset, valueEndOffset),
    });

    const nextOffset = valueEndOffset > valueStartOffset ? valueEndOffset : valueStartWithEqualsOffset;
    offset = nextOffset > offset ? nextOffset : offset + 1;
  }

  return pairs;
}

export function getHashPairAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position,
  invocation = getPartialInvocationAtPosition(document, position)
): PartialHashPair | undefined {
  if (!invocation) return undefined;

  return getHashPairs(document, invocation).find(pair =>
    pair.fullRange.contains(position) || pair.nameRange.contains(position) || pair.valueRange?.contains(position)
  );
}
