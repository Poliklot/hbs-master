import * as fs from 'fs';
import * as vscode from 'vscode';
import { HbsDocParser, HbsDocInfo } from '../hbs-doc-parser';
import { partialFilePath } from './paths';

const cache = new Map<string, HbsDocInfo>();

export function clearDocsCache() {
  cache.clear();
}

export function getDoc(componentPath: string, document?: vscode.TextDocument): HbsDocInfo | null {
  const file = partialFilePath(componentPath, document);
  if (!file || !fs.existsSync(file)) return null;

  const key = file;
  if (cache.has(key)) return cache.get(key)!;

  let parsed: HbsDocInfo | null;
  try {
    parsed = HbsDocParser.parseHbsDoc(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (parsed) cache.set(key, parsed);
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
