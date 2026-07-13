import * as fs from 'fs';
import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getDoc } from '../utils/docs';
import { partialFilePath } from '../utils/paths';
import { findPartialInvocations, getHashPairs } from '../utils/partials';

export const DIAGNOSTIC_SOURCE = 'HBS Master';

export const DiagnosticCode = {
  UnknownPartial: 'hbs-master.unknownPartial',
  UnknownParameter: 'hbs-master.unknownParameter',
  DuplicateParameter: 'hbs-master.duplicateParameter',
  MissingRequiredParameter: 'hbs-master.missingRequiredParameter',
} as const;

function configuredSeverity(document?: vscode.TextDocument): vscode.DiagnosticSeverity {
  const severity = getConfig(document).get<string>('diagnosticsSeverity', 'warning');

  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'information':
      return vscode.DiagnosticSeverity.Information;
    case 'hint':
      return vscode.DiagnosticSeverity.Hint;
    case 'warning':
    default:
      return vscode.DiagnosticSeverity.Warning;
  }
}

function createDiagnostic(
  range: vscode.Range,
  message: string,
  code: string,
  severity = configuredSeverity()
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = code;
  return diagnostic;
}

export function collectDiagnostics(doc: vscode.TextDocument): vscode.Diagnostic[] {
  if (!getConfig(doc).get('enableDiagnostics', true)) return [];

  const diagnostics: vscode.Diagnostic[] = [];
  const severity = configuredSeverity(doc);

  for (const invocation of findPartialInvocations(doc)) {
    if (!invocation.component || !invocation.componentRange) continue;

    const file = partialFilePath(invocation.component, doc);
    if (!file || !fs.existsSync(file)) {
      diagnostics.push(createDiagnostic(
        invocation.componentRange,
        `Unknown partial: ${invocation.component}`,
        DiagnosticCode.UnknownPartial,
        severity
      ));
      continue;
    }

    const info = getDoc(invocation.component, doc);
    if (!info) continue;

    const properties = new Map(info.properties.map(property => [property.name, property]));
    const pairs = getHashPairs(doc, invocation);
    const seen = new Set<string>();

    for (const pair of pairs) {
      if (seen.has(pair.name)) {
        diagnostics.push(createDiagnostic(
          pair.nameRange,
          `Duplicate parameter: ${pair.name}`,
          DiagnosticCode.DuplicateParameter,
          severity
        ));
        continue;
      }

      seen.add(pair.name);

      if (!properties.has(pair.name)) {
        diagnostics.push(createDiagnostic(
          pair.nameRange,
          `Unknown parameter "${pair.name}" for partial ${invocation.component}`,
          DiagnosticCode.UnknownParameter,
          severity
        ));
      }
    }

    for (const property of info.properties) {
      if (!property.optional && !seen.has(property.name)) {
        diagnostics.push(createDiagnostic(
          invocation.componentRange,
          `Missing required parameter "${property.name}" for partial ${invocation.component}`,
          DiagnosticCode.MissingRequiredParameter,
          severity
        ));
      }
    }
  }

  return diagnostics;
}

export function register(ctx: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection('hbs-master');
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (doc: vscode.TextDocument) => {
    collection.set(doc.uri, collectDiagnostics(doc));
  };

  const scheduleRefresh = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    debounceTimers.set(key, setTimeout(() => {
      debounceTimers.delete(key);
      refresh(doc);
    }, 150));
  };

  const refreshAll = () => {
    for (const doc of vscode.workspace.textDocuments ?? []) {
      refresh(doc);
    }
  };

  ctx.subscriptions.push(collection);

  if (vscode.workspace.onDidOpenTextDocument) {
    ctx.subscriptions.push(vscode.workspace.onDidOpenTextDocument(refresh));
  }

  if (vscode.workspace.onDidChangeTextDocument) {
    ctx.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => scheduleRefresh(event.document)));
  }

  if (vscode.workspace.onDidSaveTextDocument) {
    ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(refresh));
  }

  if (vscode.workspace.onDidCloseTextDocument) {
    ctx.subscriptions.push(vscode.workspace.onDidCloseTextDocument(doc => {
      const key = doc.uri.toString();
      const existing = debounceTimers.get(key);
      if (existing) clearTimeout(existing);
      debounceTimers.delete(key);
      collection.delete(doc.uri);
    }));
  }

  if (vscode.workspace.onDidChangeConfiguration) {
    ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('hbsMaster')) refreshAll();
      })
    );
  }

  refreshAll();
}
