import * as path from 'path';
import * as vscode from 'vscode';
import { getPartialsPath } from './config';

export function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
}

export function partialsDir(): string {
  return path.join(workspaceRoot(), getPartialsPath());
}
