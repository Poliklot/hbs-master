import * as vscode from 'vscode';

export function getConfig(document?: vscode.TextDocument) {
  return vscode.workspace.getConfiguration('hbsMaster', document?.uri);
}

function normalizeConfiguredPath(raw: string): string {
  return raw.trim().replace(/^\.[\\/]/, '').replace(/[\\/]+$/, '');
}

export function getPartialsPaths(document?: vscode.TextDocument): string[] {
  const config = getConfig(document);
  const configured = config.get<string[]>('partialsPaths', []);
  const rawPaths = configured.length
    ? configured
    : [config.get<string>('partialsPath', 'src/partials')];

  const paths = rawPaths
    .map(normalizeConfiguredPath)
    .filter(Boolean);

  return [...new Set(paths.length ? paths : ['src/partials'])];
}

export function getPartialsPath(document?: vscode.TextDocument): string {
  return getPartialsPaths(document)[0];
}
