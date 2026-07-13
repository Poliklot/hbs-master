import * as fs from 'fs';
import * as vscode from 'vscode';
import { HbsDocParser, HbsDocInfo } from '../hbs-doc-parser';
import { partialFilePath } from './paths';

interface DocsCacheEntry {
  info: HbsDocInfo;
  openDocumentText?: string;
}

const cache = new Map<string, DocsCacheEntry>();

export function clearDocsCache() {
  cache.clear();
}

export function getDoc(componentPath: string, document?: vscode.TextDocument): HbsDocInfo | null {
  const file = partialFilePath(componentPath, document);
  if (!file || !fs.existsSync(file)) return null;

  const key = file;
  const openDocument = (vscode.workspace.textDocuments ?? []).find(document => document.uri.fsPath === file);
  if (openDocument) {
    const text = openDocument.getText();
    const cached = cache.get(key);
    if (cached?.openDocumentText === text) return cached.info;

    const parsed = HbsDocParser.parseHbsDoc(text);
    if (parsed) cache.set(key, { info: parsed, openDocumentText: text });
    return parsed;
  }

  const cached = cache.get(key);
  if (cached && cached.openDocumentText === undefined) return cached.info;

  let parsed: HbsDocInfo | null;
  try {
    parsed = HbsDocParser.parseHbsDoc(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (parsed) cache.set(key, { info: parsed });
  return parsed;
}

export function watchDocs(ctx: vscode.ExtensionContext) {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{hbs,handlebars}');
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
