import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  isPathInside,
  isSafePathInside,
  PARTIAL_FILE_EXTENSIONS,
  partialsDirs,
  workspaceRoot,
} from '../utils/paths';

interface PathCompletionContext {
  rawPath: string;
  directory: string;
  filter: string;
  replacementRange: vscode.Range;
  leadingSlashRange?: vscode.Range;
}

function hasUnescapedQuote(value: string, quote: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '\\') {
      index++;
      continue;
    }
    if (value[index] === quote) return true;
  }
  return false;
}

export function getPathCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position
): PathCompletionContext | null {
  const text = document.getText();
  const cursorOffset = document.offsetAt(position);
  const openOffset = text.lastIndexOf('{{', cursorOffset);
  if (openOffset < 0) return null;

  const beforeCursor = text.slice(openOffset, cursorOffset);
  if (beforeCursor.includes('}}')) return null;

  const opener = beforeCursor.match(/^\{\{~?\s*#?>\s*/);
  if (!opener) return null;

  let pathStartOffset = openOffset + opener[0].length;
  const quote = text[pathStartOffset] === '"' || text[pathStartOffset] === "'"
    ? text[pathStartOffset]
    : null;

  if (quote) pathStartOffset++;

  const rawPath = text.slice(pathStartOffset, cursorOffset);
  if (quote ? hasUnescapedQuote(rawPath, quote) : /\s/.test(rawPath)) return null;
  if (!quote && rawPath.startsWith('(')) return null;

  const normalizedSeparators = rawPath.replace(/\\/g, '/');
  const separatorIndex = normalizedSeparators.lastIndexOf('/');
  const directory = separatorIndex >= 0 ? normalizedSeparators.slice(0, separatorIndex + 1) : '';
  const filter = separatorIndex >= 0 ? rawPath.slice(separatorIndex + 1) : rawPath;
  const replacementStartOffset = cursorOffset - filter.length;
  const leadingSlashRange = rawPath.startsWith('/')
    ? new vscode.Range(document.positionAt(pathStartOffset), document.positionAt(pathStartOffset + 1))
    : undefined;

  return {
    rawPath,
    directory,
    filter,
    replacementRange: new vscode.Range(document.positionAt(replacementStartOffset), position),
    leadingSlashRange,
  };
}

function normalizedDirectory(directory: string): string | null {
  const withoutLeadingSlash = directory.replace(/^\/+/, '');
  const parts = withoutLeadingSlash.split('/').filter(part => part && part !== '.');
  if (parts.some(part => part === '..')) return null;
  return parts.join(path.sep);
}

function extensionFor(name: string): string | undefined {
  const lower = name.toLowerCase();
  return PARTIAL_FILE_EXTENSIONS.find(extension => lower.endsWith(extension));
}

function getFileCompletions(
  context: PathCompletionContext,
  document: vscode.TextDocument
): vscode.CompletionItem[] {
  const directory = normalizedDirectory(context.directory);
  if (directory === null) return [];

  const items = new Map<string, vscode.CompletionItem>();

  for (const root of partialsDirs(document)) {
    const searchDir = path.resolve(root, directory);
    if (!isSafePathInside(root, searchDir) || !fs.existsSync(searchDir)) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(searchDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.name.toLowerCase().startsWith(context.filter.toLowerCase())) continue;

      const fullPath = path.join(searchDir, entry.name);
      if (!isPathInside(root, fullPath)) continue;
      if (entry.isSymbolicLink() && !isSafePathInside(root, fullPath)) continue;

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(fullPath);
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
        } catch {
          continue;
        }
      }

      const extension = isFile ? extensionFor(entry.name) : undefined;
      if (!isDirectory && !extension) continue;
      if (items.has(entry.name)) continue;

      const item = new vscode.CompletionItem(
        entry.name,
        isDirectory ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
      );
      item.insertText = isDirectory ? `${entry.name}/` : entry.name.slice(0, -extension!.length);
      item.range = context.replacementRange;
      item.sortText = `${isDirectory ? '0' : '1'}-${entry.name.toLowerCase()}`;

      const relativeRoot = path.relative(workspaceRoot(document), root).replace(/\\/g, '/') || '.';
      item.detail = `HBS partial · ${relativeRoot}`;

      if (context.leadingSlashRange) {
        item.additionalTextEdits = [vscode.TextEdit.delete(context.leadingSlashRange)];
      }

      if (isDirectory) {
        item.command = { command: 'editor.action.triggerSuggest', title: 'Continue partial path completion' };
      }

      items.set(entry.name, item);
    }
  }

  return [...items.values()];
}

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerCompletionItemProvider(
    'handlebars',
    {
      provideCompletionItems(document, position) {
        const completionContext = getPathCompletionContext(document, position);
        if (!completionContext) return undefined;
        return getFileCompletions(completionContext, document);
      },
    },
    "'", '"', '/', '\\', '-', '_', '.',
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'0123456789'
  );

  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const cursorChange = vscode.window.onDidChangeTextEditorSelection(event => {
    const position = event.selections[0]?.active;
    if (!position) return;

    const document = event.textEditor.document;
    const offset = document.offsetAt(position);
    const text = document.getText();
    const previous = text[offset - 1];
    const next = text[offset];
    if (!((previous === "'" && next === "'") || (previous === '"' && next === '"'))) return;
    if (!getPathCompletionContext(document, position)) return;

    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      void vscode.commands.executeCommand('editor.action.triggerSuggest');
    }, 50);
    pendingTimers.add(timer);
  });

  ctx.subscriptions.push(
    provider,
    cursorChange,
    { dispose: () => pendingTimers.forEach(timer => clearTimeout(timer)) }
  );
}
