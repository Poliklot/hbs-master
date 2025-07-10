import * as vscode from 'vscode';

export const channel = vscode.window.createOutputChannel('HBS Master Debug');

export function log(message: string) {
  const stamp = new Date().toISOString();
  channel.appendLine(`[${stamp}] ${message}`);
}
