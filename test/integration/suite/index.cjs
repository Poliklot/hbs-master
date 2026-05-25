const assert = require('node:assert/strict');
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

  const hoverResults = await vscode.commands.executeCommand(
    'vscode.executeHoverProvider',
    document.uri,
    positionOf(document, 'Save')
  );
  assert.ok(hoverResults.length > 0);
  assert.match(String(hoverResults[0].contents[0].value), /Visible label/);

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
  assert.ok(codeActions.some(action => action.title === 'Create partial "missing"'));
}

module.exports = { run };
