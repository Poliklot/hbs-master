import * as fs from 'fs';
import * as vscode from 'vscode';
import { HbsDocParser, HbsDocInfo } from '../hbs-doc-parser';
import { normalizePartialPath, partialFilePath, partialsDir } from './paths';

const cache = new Map<string, HbsDocInfo>();

function cacheKey(componentPath: string, document?: vscode.TextDocument): string | null {
  const normalized = normalizePartialPath(componentPath);
  if (!normalized) return null;

  return `${partialsDir(document)}::${normalized}`;
}

export function clearDocsCache() {
  cache.clear();
}

export function getDoc(componentPath: string, document?: vscode.TextDocument): HbsDocInfo | null {
  const key = cacheKey(componentPath, document);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;

  const file = partialFilePath(componentPath, document);
  if (!file) return null;
  if (!fs.existsSync(file)) return null;

  const parsed = HbsDocParser.parseHbsDoc(fs.readFileSync(file, 'utf8'));
  if (parsed) cache.set(key, parsed);
  return parsed;
}

export function watchDocs(ctx: vscode.ExtensionContext) {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.hbs');
  watcher.onDidChange(clearDocsCache);
  watcher.onDidCreate(clearDocsCache);
  watcher.onDidDelete(clearDocsCache);
  ctx.subscriptions.push(watcher);

  if (vscode.workspace.onDidChangeConfiguration) {
    ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('hbsMaster')) clearDocsCache();
      })
    );
  }
}
