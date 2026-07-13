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

export interface InlinePartialDefinition {
  name: string;
  nameRange: vscode.Range;
  fullRange: vscode.Range;
  scopeStartOffset: number;
  scopeEndOffset: number;
}

interface PartialParseCacheEntry {
  text: string;
  version?: number;
  invocations: PartialInvocation[];
  inlineDefinitions: InlinePartialDefinition[];
}

const partialParseCache = new WeakMap<vscode.TextDocument, PartialParseCacheEntry>();

const PARTIAL_OPEN_RE = /\{\{~?\s*(#?)>\s*/g;
const INLINE_PARTIAL_OPEN_RE = /\{\{~?\s*#\*inline\s+/g;

export function isRuntimePartial(component: string): boolean {
  return component === '@partial-block';
}

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
  path?: string;
  params?: string[];
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
  inlineDefinitions: Array<{
    name: string;
    start: number;
    scopeStartOffset: number;
    scopeEndOffset: number;
  }>;
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
    const inlineDefinitions: AstPartialIndex['inlineDefinitions'] = [];
    const visit = (
      node: AstNode | null | undefined,
      scope: [number, number] = [0, text.length]
    ) => {
      if (!node) return;

      let currentScope = scope;
      if (node.type === 'Program') {
        const start = parser.locStart(node);
        const end = parser.locEnd(node);
        if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
          currentScope = [start, end];
        }
      }

      if (node.type === 'PartialStatement' || (node.type === 'BlockStatement' && node.blockPrefix === '#>')) {
        const start = parser.locStart(node);
        if (Number.isInteger(start) && start >= 0) starts.add(start);
      }

      if (node.type === 'BlockStatement' && node.blockPrefix === '#*' && node.path === 'inline') {
        const start = parser.locStart(node);
        const rawName = node.params?.[0];
        const name = rawName?.replace(/^(['"])(.*)\1$/, '$2');
        if (name && Number.isInteger(start) && start >= 0) {
          inlineDefinitions.push({
            name,
            start,
            scopeStartOffset: currentScope[0],
            scopeEndOffset: currentScope[1],
          });
        }
      }

      if (node.type === 'UnmatchedNode') {
        const start = parser.locStart(node);
        const end = parser.locEnd(node);
        if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
          unmatchedRanges.push([start, end]);
        }
      }

      node.body?.forEach(child => visit(child, currentScope));
      node.children?.forEach(child => visit(child, currentScope));
      node.parts?.forEach(child => visit(child, currentScope));
      node.attributes?.forEach(attribute => {
        visit(attribute.value, currentScope);
        visit(attribute.block, currentScope);
      });
      visit(node.block, currentScope);
      visit(node.program, currentScope);
      visit(node.inverse, currentScope);
      node.inverseChain?.forEach(child => visit(child, currentScope));
    };

    visit(ast);
    return { starts, unmatchedRanges, inlineDefinitions };
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

function scanInlinePartialDefinitions(document: vscode.TextDocument): InlinePartialDefinition[] {
  const text = document.getText();
  const definitions: InlinePartialDefinition[] = [];

  INLINE_PARTIAL_OPEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_PARTIAL_OPEN_RE.exec(text))) {
    const closeOffset = findClosingMustache(text, INLINE_PARTIAL_OPEN_RE.lastIndex);
    if (closeOffset < 0) break;

    const closeStartOffset = contentEndBeforeClosingMustache(text, closeOffset - 2);
    const nameStartOffset = skipWhitespace(text, INLINE_PARTIAL_OPEN_RE.lastIndex, closeStartOffset);
    const quote = text[nameStartOffset] === '"' || text[nameStartOffset] === "'"
      ? text[nameStartOffset]
      : null;
    const nameEndOffset = quote
      ? readQuoted(text, nameStartOffset, quote, closeStartOffset)
      : readBareToken(text, nameStartOffset, closeStartOffset);
    const hasClosingQuote = quote && text[nameEndOffset - 1] === quote;
    const name = quote
      ? hasClosingQuote ? text.slice(nameStartOffset + 1, nameEndOffset - 1) : ''
      : text.slice(nameStartOffset, nameEndOffset);

    if (name) {
      definitions.push({
        name,
        nameRange: quote
          ? toRange(document, nameStartOffset + 1, nameEndOffset - 1)
          : toRange(document, nameStartOffset, nameEndOffset),
        fullRange: toRange(document, match.index, closeOffset),
        scopeStartOffset: 0,
        scopeEndOffset: text.length,
      });
    }

    INLINE_PARTIAL_OPEN_RE.lastIndex = closeOffset;
  }

  return definitions;
}

function parsePartialDocument(document: vscode.TextDocument): PartialParseCacheEntry {
  const text = document.getText();
  const version = typeof document.version === 'number' ? document.version : undefined;
  const cached = partialParseCache.get(document);

  if (cached && cached.text === text && cached.version === version) return cached;

  const scannedInvocations = scanPartialInvocations(document);
  const scannedInlineDefinitions = scanInlinePartialDefinitions(document);
  const astIndex = getAstPartialIndex(text);
  const invocations = astIndex
    ? scannedInvocations.filter(invocation => {
        const start = document.offsetAt(invocation.fullRange.start);
        return astIndex.starts.has(start)
          || astIndex.unmatchedRanges.some(([rangeStart, rangeEnd]) => start >= rangeStart && start < rangeEnd);
      })
    : scannedInvocations;
  const inlineDefinitions = astIndex
    ? scannedInlineDefinitions.flatMap(definition => {
        const start = document.offsetAt(definition.fullRange.start);
        const astDefinition = astIndex.inlineDefinitions.find(candidate =>
          candidate.start === start && candidate.name === definition.name
        );
        return astDefinition
          ? [{
              ...definition,
              scopeStartOffset: astDefinition.scopeStartOffset,
              scopeEndOffset: astDefinition.scopeEndOffset,
            }]
          : [];
      })
    : scannedInlineDefinitions;

  const entry = { text, version, invocations, inlineDefinitions };
  partialParseCache.set(document, entry);
  return entry;
}

export function findPartialInvocations(document: vscode.TextDocument): PartialInvocation[] {
  return parsePartialDocument(document).invocations;
}

export function findInlinePartialDefinitions(document: vscode.TextDocument): InlinePartialDefinition[] {
  return parsePartialDocument(document).inlineDefinitions;
}

export function getVisibleInlinePartialDefinition(
  document: vscode.TextDocument,
  component: string,
  position: vscode.Position
): InlinePartialDefinition | undefined {
  const offset = document.offsetAt(position);
  return findInlinePartialDefinitions(document)
    .filter(definition =>
      definition.name === component
      && offset >= document.offsetAt(definition.fullRange.end)
      && offset >= definition.scopeStartOffset
      && offset < definition.scopeEndOffset
    )
    .sort((left, right) => {
      const leftScope = left.scopeEndOffset - left.scopeStartOffset;
      const rightScope = right.scopeEndOffset - right.scopeStartOffset;
      return leftScope - rightScope || document.offsetAt(right.fullRange.start) - document.offsetAt(left.fullRange.start);
    })[0];
}

export function getPartialInvocationAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): PartialInvocation | undefined {
  const offset = document.offsetAt(position);
  return findPartialInvocations(document).find(invocation => {
    const start = document.offsetAt(invocation.fullRange.start);
    const end = document.offsetAt(invocation.fullRange.end);
    return offset >= start && offset < end;
  });
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
