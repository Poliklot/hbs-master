import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getPartialsPaths } from './config';

export const PARTIAL_FILE_EXTENSIONS = ['.hbs', '.handlebars'] as const;

export function workspaceRoot(document?: vscode.TextDocument): string {
  const folder = document && vscode.workspace.getWorkspaceFolder
    ? vscode.workspace.getWorkspaceFolder(document.uri)
    : undefined;

  return folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? '';
}

export function partialsDir(document?: vscode.TextDocument): string {
  return partialsDirs(document)[0] ?? '';
}

export function partialsDirs(document?: vscode.TextDocument): string[] {
  const root = workspaceRoot(document);
  if (!root) return [];

  return getPartialsPaths(document).map(configuredPath => path.resolve(root, configuredPath));
}

export function normalizePartialPath(componentPath: string): string | null {
  const normalized = componentPath
    .trim()
    .replace(/^\.?[\\/]/, '')
    .replace(/\\/g, '/')
    .replace(/\.(?:hbs|handlebars)$/i, '');

  if (normalized.includes('\0')) return null;

  const parts = normalized.split('/').filter(part => part && part !== '.');
  if (!parts.length || parts.some(part => part === '..')) return null;

  return parts.join('/');
}

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function nearestExistingPath(candidate: string): string | null {
  let current = path.resolve(candidate);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }

  return current;
}

export function isSafePathInside(root: string, candidate: string): boolean {
  if (!isPathInside(root, candidate)) return false;

  const existingRoot = nearestExistingPath(root);
  const existingCandidate = nearestExistingPath(candidate);
  if (!existingRoot || !existingCandidate) return true;

  try {
    return isPathInside(fs.realpathSync(existingRoot), fs.realpathSync(existingCandidate));
  } catch {
    return false;
  }
}

function partialCandidates(root: string, normalized: string): string[] {
  const direct = PARTIAL_FILE_EXTENSIONS.map(extension => path.resolve(root, `${normalized}${extension}`));
  const index = PARTIAL_FILE_EXTENSIONS.map(extension => path.resolve(root, normalized, `index${extension}`));
  return [...direct, ...index];
}

export function partialFilePath(componentPath: string, document?: vscode.TextDocument): string | null {
  const normalized = normalizePartialPath(componentPath);
  if (!normalized) return null;

  let firstSafeCandidate: string | null = null;

  for (const root of partialsDirs(document)) {
    for (const candidate of partialCandidates(root, normalized)) {
      if (!isSafePathInside(root, candidate)) continue;
      firstSafeCandidate ??= candidate;
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return firstSafeCandidate;
}

export function partialRootForFile(file: string, document?: vscode.TextDocument): string | null {
  return partialsDirs(document).find(root => isSafePathInside(root, file)) ?? null;
}
