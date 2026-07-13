import * as vscode from 'vscode';
import * as fs from 'fs';
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
  const name = (parts[parts.length - 1] ?? component).replace(/[{}]/g, '');
  return Buffer.from(`{{!--
  @name ${name}

  @parameters
--}}

`, 'utf8');
}

function missingRequiredName(message: string): string | null {
  return message.match(/Missing required parameter "([^"]+)"/)?.[1] ?? null;
}

function parameterRemovalRange(
  document: vscode.TextDocument,
  invocation: ReturnType<typeof findPartialInvocations>[number],
  pair: NonNullable<ReturnType<typeof getHashPairAtPosition>>
): vscode.Range {
  const text = document.getText();
  let start = document.offsetAt(pair.fullRange.start);
  let end = document.offsetAt(pair.fullRange.end);
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextLineBreak = text.indexOf('\n', end);
  const prefixOnLine = text.slice(lineStart, start);

  if (!prefixOnLine.trim() && nextLineBreak >= 0 && nextLineBreak <= invocation.hashEndOffset) {
    const suffixOnLine = text.slice(end, nextLineBreak);
    if (!suffixOnLine.trim()) {
      return new vscode.Range(document.positionAt(lineStart), document.positionAt(nextLineBreak + 1));
    }
  }

  while (start > invocation.hashStartOffset && /[ \t]/.test(text[start - 1])) start--;
  if (start === document.offsetAt(pair.fullRange.start)) {
    while (end < invocation.hashEndOffset && /[ \t]/.test(text[end])) end++;
  }

  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

function quoteValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function requiredParameterText(name: string, type: string, defaultValue?: string): string {
  const normalizedType = type.trim().replace(/\s+/g, ' ');

  if (defaultValue !== undefined) {
    const unquotedDefault = defaultValue.replace(/^(['"])(.*)\1$/, '$2');
    if (normalizedType === 'boolean' && /^(?:true|false)$/.test(unquotedDefault)) {
      return `${name}=${unquotedDefault}`;
    }
    if (/^(?:number|bigint)$/.test(normalizedType) && /^-?\d+(?:\.\d+)?$/.test(unquotedDefault)) {
      return `${name}=${unquotedDefault}`;
    }
    return `${name}=${quoteValue(unquotedDefault)}`;
  }

  if (normalizedType === 'boolean') return `${name}=false`;
  if (/^(?:number|bigint)$/.test(normalizedType)) return `${name}=0`;

  const firstLiteral = normalizedType.split('|')[0]?.trim().match(/^(['"])(.*)\1$/)?.[2];
  return `${name}=${quoteValue(firstLiteral ?? '')}`;
}

function requiredParameterEdit(
  document: vscode.TextDocument,
  invocation: ReturnType<typeof findPartialInvocations>[number],
  parameter: string
): { position: vscode.Position; text: string } {
  const insertion = document.positionAt(invocation.hashEndOffset);
  const lineStart = document.offsetAt(new vscode.Position(insertion.line, 0));
  const prefix = document.getText().slice(lineStart, invocation.hashEndOffset);

  if (insertion.line > invocation.fullRange.start.line && !prefix.trim()) {
    const invocationLine = document.lineAt(invocation.fullRange.start.line).text;
    const baseIndent = invocationLine.match(/^\s*/)?.[0] ?? '';
    const indentUnit = baseIndent.includes('\t') ? '\t' : '  ';
    return {
      position: new vscode.Position(insertion.line, 0),
      text: `${baseIndent}${indentUnit}${parameter}\n`,
    };
  }

  return { position: insertion, text: ` ${parameter}` };
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
      if (vscode.workspace.isTrusted === false) continue;
      const invocation = invocations.find(item => item.componentRange?.contains(range.start));
      if (!invocation?.component) continue;

      const file = partialFilePath(invocation.component, document);
      if (!file) continue;

      const codeAction = action(`Create partial "${invocation.component}"`, diagnostic);
      codeAction.command = {
        command: 'hbsMaster.createPartial',
        title: 'Create partial',
        arguments: [document.uri, invocation.component],
      };
      actions.push(codeAction);
      continue;
    }

    if (code === DiagnosticCode.UnknownParameter || code === DiagnosticCode.DuplicateParameter) {
      const invocation = invocations.find(item => item.fullRange.contains(range.start));
      if (!invocation) continue;
      const pair = getHashPairAtPosition(document, range.start);
      if (!pair) continue;

      const edit = new vscode.WorkspaceEdit();
      edit.delete(document.uri, parameterRemovalRange(document, invocation, pair));

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
      const parameter = requiredParameterText(property.name, property.type, property.defaultValue);
      const insertion = requiredParameterEdit(document, invocation, parameter);
      edit.insert(document.uri, insertion.position, insertion.text);

      const codeAction = action(`Add required parameter "${property.name}"`, diagnostic);
      codeAction.edit = edit;
      actions.push(codeAction);
    }
  }

  return actions;
}

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('hbsMaster.createPartial', async (documentUri: vscode.Uri, component: string) => {
      if (vscode.workspace.isTrusted === false) return;

      const sourceDocument = await vscode.workspace.openTextDocument(documentUri);
      const file = partialFilePath(component, sourceDocument);
      if (!file) return;

      const uri = vscode.Uri.file(file);
      if (!fs.existsSync(file)) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)));
        await vscode.workspace.fs.writeFile(uri, partialSkeleton(component));
      }

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
