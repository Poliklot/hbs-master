import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getPartialsPath } from './config';

export function workspaceRoot(document?: vscode.TextDocument): string {
  const folder = document && vscode.workspace.getWorkspaceFolder
    ? vscode.workspace.getWorkspaceFolder(document.uri)
    : undefined;

  return folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
}

export function partialsDir(document?: vscode.TextDocument): string {
  return path.join(workspaceRoot(document), getPartialsPath());
}

export function normalizePartialPath(componentPath: string): string | null {
  const normalized = componentPath
    .trim()
    .replace(/^\.?[\\/]/, '')
    .replace(/\\/g, '/')
    .replace(/\.hbs$/i, '');

  const parts = normalized.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..')) return null;

  return parts.join('/');
}

export function partialFilePath(componentPath: string, document?: vscode.TextDocument): string | null {
  const normalized = normalizePartialPath(componentPath);
  if (!normalized) return null;

  const direct = path.join(partialsDir(document), `${normalized}.hbs`);
  if (fs.existsSync(direct)) return direct;

  const index = path.join(partialsDir(document), normalized, 'index.hbs');
  if (fs.existsSync(index)) return index;

  return direct;
}
