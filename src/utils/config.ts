import * as vscode from 'vscode';

export function getConfig() {
  return vscode.workspace.getConfiguration('hbsMaster');
}

export function getPartialsPath(): string {
  const raw = getConfig().get<string>('partialsPath', 'src/partials');
  return raw.replace(/^\.?[\\/]/, '');          // убираем ./ или /
}
