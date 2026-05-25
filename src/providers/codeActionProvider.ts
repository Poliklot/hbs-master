import * as vscode from 'vscode';
import * as path from 'path';
import { getDoc } from '../utils/docs';
import { partialFilePath } from '../utils/paths';
import { findPartialInvocations, getHashPairAtPosition } from '../utils/partials';
import { DIAGNOSTIC_SOURCE, DiagnosticCode } from './diagnosticsProvider';

function diagnosticCode(diagnostic: vscode.Diagnostic): string {
  if (typeof diagnostic.code === 'string') return diagnostic.code;
  if (typeof diagnostic.code === 'number') return String(diagnostic.code);
  return diagnostic.code?.value ? String(diagnostic.code.value) : '';
}

function isHbsMasterDiagnostic(diagnostic: vscode.Diagnostic): boolean {
  return diagnostic.source === DIAGNOSTIC_SOURCE || diagnosticCode(diagnostic).startsWith('hbs-master.');
}

function action(title: string, diagnostic: vscode.Diagnostic): vscode.CodeAction {
  const codeAction = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
  codeAction.diagnostics = [diagnostic];
  codeAction.isPreferred = true;
  return codeAction;
}

function partialSkeleton(component: string): Uint8Array {
  const parts = component.split('/');
  const name = parts[parts.length - 1] ?? component;
  return Buffer.from(`{{!--
  @name ${name}

  @parameters
--}}

`, 'utf8');
}

function missingRequiredName(message: string): string | null {
  return message.match(/Missing required parameter "([^"]+)"/)?.[1] ?? null;
}

export function createCodeActions(
  document: vscode.TextDocument,
  range: vscode.Range,
  diagnostics: readonly vscode.Diagnostic[]
): vscode.CodeAction[] {
  const actions: vscode.CodeAction[] = [];
  const invocations = findPartialInvocations(document);

  for (const diagnostic of diagnostics.filter(isHbsMasterDiagnostic)) {
    const code = diagnosticCode(diagnostic);

    if (code === DiagnosticCode.UnknownPartial) {
      const invocation = invocations.find(item => item.componentRange?.contains(range.start));
      if (!invocation?.component) continue;

      const file = partialFilePath(invocation.component, document);
      if (!file) continue;

      const codeAction = action(`Create partial "${invocation.component}"`, diagnostic);
      codeAction.command = {
        command: 'hbsMaster.createPartial',
        title: 'Create partial',
        arguments: [vscode.Uri.file(file), invocation.component],
      };
      actions.push(codeAction);
      continue;
    }

    if (code === DiagnosticCode.UnknownParameter || code === DiagnosticCode.DuplicateParameter) {
      const pair = getHashPairAtPosition(document, range.start);
      if (!pair) continue;

      const edit = new vscode.WorkspaceEdit();
      edit.delete(document.uri, pair.fullRange);

      const codeAction = action(`Remove parameter "${pair.name}"`, diagnostic);
      codeAction.edit = edit;
      actions.push(codeAction);
      continue;
    }

    if (code === DiagnosticCode.MissingRequiredParameter) {
      const propertyName = missingRequiredName(diagnostic.message);
      if (!propertyName) continue;

      const invocation = invocations.find(item => item.componentRange?.contains(range.start));
      if (!invocation?.component) continue;

      const info = getDoc(invocation.component, document);
      const property = info?.properties.find(item => item.name === propertyName);
      if (!property) continue;

      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, document.positionAt(invocation.hashEndOffset), ` ${property.name}="${property.defaultValue ?? property.type}"`);

      const codeAction = action(`Add required parameter "${property.name}"`, diagnostic);
      codeAction.edit = edit;
      actions.push(codeAction);
    }
  }

  return actions;
}

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('hbsMaster.createPartial', async (uri: vscode.Uri, component: string) => {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
      await vscode.workspace.fs.writeFile(uri, partialSkeleton(component));
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    })
  );

  const provider = vscode.languages.registerCodeActionsProvider(
    'handlebars',
    {
      provideCodeActions(document, range, context) {
        return createCodeActions(document, range, context.diagnostics);
      },
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );

  ctx.subscriptions.push(provider);
}
