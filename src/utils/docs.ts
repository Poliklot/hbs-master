import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { HbsDocParser, HbsDocInfo } from '../hbs-doc-parser';
import { partialsDir } from './paths';

const cache = new Map<string, HbsDocInfo>();

export function getDoc(componentPath: string): HbsDocInfo | null {
  if (cache.has(componentPath)) return cache.get(componentPath)!;

  const file = path.join(partialsDir(), `${componentPath}.hbs`);
  if (!fs.existsSync(file)) return null;

  const parsed = HbsDocParser.parseHbsDoc(fs.readFileSync(file, 'utf8'));
  if (parsed) cache.set(componentPath, parsed);
  return parsed;
}

export function watchDocs(ctx: vscode.ExtensionContext) {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.hbs');
  watcher.onDidChange(() => cache.clear());
  watcher.onDidCreate(() => cache.clear());
  watcher.onDidDelete(() => cache.clear());
  ctx.subscriptions.push(watcher);
}
