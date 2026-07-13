const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

function positionOf(document, needle, delta = 0) {
  const text = document.getText();
  const index = text.indexOf(needle);
  if (index === -1) throw new Error(`Needle not found: ${needle}`);
  return document.positionAt(index + delta);
}

async function waitFor(predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function run() {
  const workspaceRoot = process.env.HBS_MASTER_SMOKE_WORKSPACE;
  assert.ok(workspaceRoot, 'HBS_MASTER_SMOKE_WORKSPACE is required');

  const documentUri = vscode.Uri.file(path.join(workspaceRoot, 'pages', 'home.hbs'));
  const document = await vscode.workspace.openTextDocument(documentUri);
  await vscode.window.showTextDocument(document);

  assert.equal(document.languageId, 'handlebars');

  const extension = vscode.extensions.getExtension('poliklot.hbs-master');
  assert.ok(extension, 'Extension poliklot.hbs-master should be discoverable');
  await extension.activate();
  assert.equal(extension.isActive, true);

  const definitionPosition = positionOf(document, 'button');
  const definitions = await vscode.commands.executeCommand(
    'vscode.executeDefinitionProvider',
    document.uri,
    definitionPosition
  );
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].uri.fsPath, path.join(workspaceRoot, 'components', 'button.hbs'));

  const linkResults = await vscode.commands.executeCommand('vscode.executeLinkProvider', document.uri);
  const targets = linkResults.map(link => link.target?.fsPath).filter(Boolean);
  assert.ok(targets.includes(path.join(workspaceRoot, 'components', 'button.hbs')));
  assert.ok(targets.includes(path.join(workspaceRoot, 'components', 'card.hbs')));
  assert.ok(targets.includes(path.join(workspaceRoot, 'components', 'badge.handlebars')));
  assert.equal(targets.some(target => target.endsWith(path.join('components', 'missing.hbs'))), false);

  const completions = await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider',
    document.uri,
    positionOf(document, ' d', 2),
    'd'
  );
  const completionLabels = completions.items.map(item => item.label.label ?? item.label);
  assert.ok(completionLabels.includes('disabled'));
  assert.equal(completionLabels.includes('text'), false);

  const pathCompletionUri = vscode.Uri.file(path.join(workspaceRoot, 'pages', 'completion.hbs'));
  const pathCompletionDocument = await vscode.workspace.openTextDocument(pathCompletionUri);
  const quotedPathCompletions = await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider',
    pathCompletionDocument.uri,
    positionOf(pathCompletionDocument, 'but', 3),
    't'
  );
  const quotedPathLabels = quotedPathCompletions.items.map(item => item.label.label ?? item.label);
  assert.ok(quotedPathLabels.includes('button.hbs'));

  const unquotedPathCompletions = await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider',
    pathCompletionDocument.uri,
    positionOf(pathCompletionDocument, 'car', 3),
    'r'
  );
  const unquotedPathLabels = unquotedPathCompletions.items.map(item => item.label.label ?? item.label);
  assert.ok(unquotedPathLabels.includes('card.hbs'));

  const handlebarPathCompletions = await vscode.commands.executeCommand(
    'vscode.executeCompletionItemProvider',
    pathCompletionDocument.uri,
    positionOf(pathCompletionDocument, 'bad', 3),
    'd'
  );
  const handlebarPathLabels = handlebarPathCompletions.items.map(item => item.label.label ?? item.label);
  assert.ok(handlebarPathLabels.includes('badge.handlebars'));

  const hoverResults = await vscode.commands.executeCommand(
    'vscode.executeHoverProvider',
    document.uri,
    positionOf(document, 'Save')
  );
  assert.ok(hoverResults.length > 0);
  assert.match(String(hoverResults[0].contents[0].value), /Visible label/);

  const signatureHelp = await vscode.commands.executeCommand(
    'vscode.executeSignatureHelpProvider',
    document.uri,
    positionOf(document, 'Save')
  );
  assert.match(signatureHelp.signatures[0].label, /^Button\(text: string, disabled\?: boolean\)$/);
  assert.equal(signatureHelp.activeParameter, 0);

  const highlights = await vscode.commands.executeCommand(
    'vscode.executeDocumentHighlights',
    document.uri,
    positionOf(document, 'Save')
  );
  assert.ok(highlights.some(highlight => document.getText(highlight.range) === 'text'));

  const inlineDefinitionPosition = positionOf(document, '{{> local-label', 4);
  const inlineDefinitions = await vscode.commands.executeCommand(
    'vscode.executeDefinitionProvider',
    document.uri,
    inlineDefinitionPosition
  );
  assert.equal(inlineDefinitions.length, 1);
  assert.equal(inlineDefinitions[0].uri.toString(), document.uri.toString());

  const diagnostics = await waitFor(
    () => {
      const current = vscode.languages.getDiagnostics(document.uri);
      return current.length >= 2 ? current : null;
    },
    'HBS Master diagnostics'
  );
  const messages = diagnostics.map(diagnostic => diagnostic.message);
  assert.ok(messages.includes('Unknown partial: missing'));
  assert.ok(messages.includes('Unknown parameter "bogus" for partial missing') === false);
  assert.ok(messages.includes('Missing required parameter "title" for partial card'));

  const codeActions = await vscode.commands.executeCommand(
    'vscode.executeCodeActionProvider',
    document.uri,
    diagnostics.find(diagnostic => diagnostic.message === 'Unknown partial: missing').range,
    vscode.CodeActionKind.QuickFix.value
  );
  const createAction = codeActions.find(action => action.title === 'Create partial "missing"');
  assert.ok(createAction);

  const missingPartial = path.join(workspaceRoot, 'components', 'missing.hbs');
  try {
    if (fs.existsSync(missingPartial)) fs.unlinkSync(missingPartial);
    await vscode.commands.executeCommand(
      createAction.command.command,
      ...(createAction.command.arguments ?? [])
    );
    await waitFor(() => fs.existsSync(missingPartial), 'missing partial creation');
    await waitFor(
      () => vscode.languages.getDiagnostics(document.uri)
        .every(diagnostic => diagnostic.message !== 'Unknown partial: missing'),
      'diagnostic refresh after partial creation'
    );
  } finally {
    if (fs.existsSync(missingPartial)) fs.unlinkSync(missingPartial);
  }
}

module.exports = { run };
