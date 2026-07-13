import * as vscode from 'vscode';

export function getConfig(document?: vscode.TextDocument) {
  return vscode.workspace.getConfiguration('hbsMaster', document?.uri);
}

function normalizeConfiguredPath(raw: string): string {
  return raw.trim().replace(/^\.[\\/]/, '').replace(/[\\/]+$/, '');
}

export function getPartialsPaths(document?: vscode.TextDocument): string[] {
  const config = getConfig(document);
  const configuredValue = config.get<unknown>('partialsPaths', []);
  const configured = Array.isArray(configuredValue)
    ? configuredValue.filter((value): value is string => typeof value === 'string')
    : [];
  const legacyValue = config.get<unknown>('partialsPath', 'src/partials');
  const legacyPath = typeof legacyValue === 'string' ? legacyValue : 'src/partials';
  const rawPaths = configured.length
    ? configured
    : [legacyPath];

  const paths = rawPaths
    .map(normalizeConfiguredPath)
    .filter(Boolean);

  return [...new Set(paths.length ? paths : ['src/partials'])];
}

export function getPartialsPath(document?: vscode.TextDocument): string {
  return getPartialsPaths(document)[0];
}
