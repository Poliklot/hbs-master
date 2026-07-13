const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installVscodeMock, vscode } = require('./support/vscode-mock.cjs');
const { TestTextDocument, positionOf, positionAfter } = require('./support/text-document.cjs');

installVscodeMock();

function fresh(modulePath) {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}dist${path.sep}`)) delete require.cache[key];
  }
  return require(modulePath);
}

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hbs-master-tests-'));
  const partials = path.join(root, 'src', 'partials');
  fs.mkdirSync(path.join(partials, 'components'), { recursive: true });
  fs.mkdirSync(path.join(partials, 'layout'), { recursive: true });
  fs.writeFileSync(path.join(partials, 'components', 'button.hbs'), `{{!--
    @name Button
    @description Reusable button.
    @parameters
    @description Visible label
    text: string;
    @description Disabled state
    disabled?: boolean;
    @description Analytics label
    analytics-label?: string;
  --}}
  <button>{{text}}</button>`);
  fs.writeFileSync(path.join(partials, 'components', 'card.hbs'), `{{!--
    @name Card
    @parameters
    title: string;
  --}}`);
  fs.mkdirSync(path.join(partials, 'components', 'panel'), { recursive: true });
  fs.writeFileSync(path.join(partials, 'components', 'panel', 'index.hbs'), `{{!--
    @name Panel
    @parameters
    title: string;
  --}}`);
  fs.writeFileSync(path.join(partials, 'components', 'README.md'), 'not a partial');
  fs.writeFileSync(path.join(partials, '.hidden.hbs'), 'hidden');
  return { root, partials };
}

function resetMock(workspaceRoot, config = {}) {
  vscode.__mock.reset();
  vscode.__mock.setWorkspaceRoot(workspaceRoot);
  vscode.__mock.setConfig({
    'hbsMaster.partialsPath': 'src/partials',
    'hbsMaster.enableHoverDocs': true,
    'hbsMaster.enableSignatureHelp': true,
    'hbsMaster.enableParameterHighlight': true,
    'hbsMaster.enableDiagnostics': true,
    ...config,
  });
}

test('config and path utilities normalize partials path against workspace root', () => {
  const { root } = makeWorkspace();
  resetMock(root, { 'hbsMaster.partialsPath': './components' });

  const config = fresh('../dist/utils/config.js');
  const paths = fresh('../dist/utils/paths.js');

  assert.equal(config.getPartialsPath(), 'components');
  assert.equal(paths.workspaceRoot(), root);
  assert.equal(paths.partialsDir(), path.join(root, 'components'));
});

test('config and path utilities support multiple partial roots and .handlebars files', () => {
  const { root } = makeWorkspace();
  const secondary = path.join(root, 'shared', 'partials');
  fs.mkdirSync(path.join(secondary, 'widgets'), { recursive: true });
  fs.writeFileSync(path.join(secondary, 'widgets', 'badge.handlebars'), '<span>Badge</span>');
  resetMock(root, { 'hbsMaster.partialsPaths': ['./src/partials/', 'shared/partials'] });

  const config = fresh('../dist/utils/config.js');
  const paths = fresh('../dist/utils/paths.js');

  assert.deepEqual(config.getPartialsPaths(), ['src/partials', 'shared/partials']);
  assert.deepEqual(paths.partialsDirs(), [path.join(root, 'src', 'partials'), secondary]);
  assert.equal(paths.partialFilePath('widgets/badge'), path.join(secondary, 'widgets', 'badge.handlebars'));
  assert.equal(paths.partialFilePath('../outside'), null);
});

test('docs utility reads HBSDoc, caches it, and watcher invalidates cache', () => {
  const { root, partials } = makeWorkspace();
  resetMock(root);

  const docs = fresh('../dist/utils/docs.js');
  const ctx = { subscriptions: [] };
  docs.watchDocs(ctx);

  const first = docs.getDoc('components/button');
  assert.equal(first.name, 'Button');

  fs.writeFileSync(path.join(partials, 'components', 'button.hbs'), `{{!--
    @name Button changed
    @parameters
    text: string;
  --}}`);

  assert.equal(docs.getDoc('components/button').name, 'Button');
  assert.equal(ctx.subscriptions.length, 2);
  vscode.__mock.state.watchers[0].fireChange(vscode.Uri.file(path.join(partials, 'components', 'button.hbs')));
  assert.equal(docs.getDoc('components/button').name, 'Button changed');

  fs.writeFileSync(path.join(partials, 'components', 'button.hbs'), `{{!--
    @name Button changed by config
    @parameters
    text: string;
  --}}`);

  assert.equal(docs.getDoc('components/button').name, 'Button changed');
  vscode.__mock.fireConfigurationChange('hbsMaster.partialsPath');
  assert.equal(docs.getDoc('components/button').name, 'Button changed by config');
});

test('definition provider resolves existing partials for single and double quoted paths', () => {
  const { root, partials } = makeWorkspace();
  resetMock(root);

  const def = fresh('../dist/providers/definitionProvider.js');
  const ctx = { subscriptions: [] };
  def.register(ctx);
  const provider = vscode.__mock.lastRegistration('definition').provider;

  const singleDoc = new TestTextDocument(`{{> 'components/button' text="Save"}}`);
  const single = provider.provideDefinition(singleDoc, positionOf(singleDoc, 'components/button', 3));
  assert.equal(single.uri.fsPath, path.join(partials, 'components', 'button.hbs'));

  const doubleDoc = new TestTextDocument(`{{> "components/card" title="A"}}`);
  const double = provider.provideDefinition(doubleDoc, positionOf(doubleDoc, 'components/card', 2));
  assert.equal(double.uri.fsPath, path.join(partials, 'components', 'card.hbs'));

  const outside = provider.provideDefinition(singleDoc, positionAfter(singleDoc, 'text="Save"'));
  assert.equal(outside, undefined);
});

test('definition provider resolves multiline, unquoted and block partial paths', () => {
  const { root, partials } = makeWorkspace();
  resetMock(root);

  const def = fresh('../dist/providers/definitionProvider.js');
  const ctx = { subscriptions: [] };
  def.register(ctx);
  const provider = vscode.__mock.lastRegistration('definition').provider;

  const multilineDoc = new TestTextDocument(`{{>
    "components/button"
    text="Save"
  }}`);
  const multiline = provider.provideDefinition(multilineDoc, positionOf(multilineDoc, 'components/button'));
  assert.equal(multiline.uri.fsPath, path.join(partials, 'components', 'button.hbs'));

  const unquotedDoc = new TestTextDocument(`{{> components/card title="A"}}`);
  const unquoted = provider.provideDefinition(unquotedDoc, positionOf(unquotedDoc, 'components/card'));
  assert.equal(unquoted.uri.fsPath, path.join(partials, 'components', 'card.hbs'));

  const blockDoc = new TestTextDocument(`{{#> "components/button"
    text="Save"
  }}fallback{{/components/button}}`);
  const block = provider.provideDefinition(blockDoc, positionOf(blockDoc, 'components/button'));
  assert.equal(block.uri.fsPath, path.join(partials, 'components', 'button.hbs'));

  const attributeDoc = new TestTextDocument(`<div {{> "components/button" text="Save"}}></div>`);
  const attribute = provider.provideDefinition(attributeDoc, positionOf(attributeDoc, 'components/button'));
  assert.equal(attribute.uri.fsPath, path.join(partials, 'components', 'button.hbs'));

  const indexDoc = new TestTextDocument(`{{> "components/panel" title="A"}}`);
  const index = provider.provideDefinition(indexDoc, positionOf(indexDoc, 'components/panel'));
  assert.equal(index.uri.fsPath, path.join(partials, 'components', 'panel', 'index.hbs'));
});

test('link provider returns document links only for existing partial targets', () => {
  const { root, partials } = makeWorkspace();
  resetMock(root);

  const link = fresh('../dist/providers/linkProvider.js');
  const ctx = { subscriptions: [] };
  link.register(ctx);
  const provider = vscode.__mock.lastRegistration('link').provider;
  const document = new TestTextDocument(`{{> 'components/button'}}\n{{> "components/missing"}}\n{{> "components/card"}}`);

  const links = provider.provideDocumentLinks(document);
  assert.equal(links.length, 2);
  assert.equal(links[0].target.fsPath, path.join(partials, 'components', 'button.hbs'));
  assert.equal(document.getText(links[0].range), 'components/button');
  assert.equal(links[1].target.fsPath, path.join(partials, 'components', 'card.hbs'));
});

test('link provider supports multiline partials and ignores dynamic partial names', () => {
  const { root, partials } = makeWorkspace();
  resetMock(root);

  const link = fresh('../dist/providers/linkProvider.js');
  const ctx = { subscriptions: [] };
  link.register(ctx);
  const provider = vscode.__mock.lastRegistration('link').provider;
  const document = new TestTextDocument(`{{>
  "components/button"
  text="Save"
}}
{{> (lookup . "partial")}}
{{#> components/card title="A"}}fallback{{/components/card}}
<div {{> "components/button" text="Save"}}></div>`);

  const links = provider.provideDocumentLinks(document);
  assert.equal(links.length, 3);
  assert.equal(document.getText(links[0].range), 'components/button');
  assert.equal(links[0].target.fsPath, path.join(partials, 'components', 'button.hbs'));
  assert.equal(document.getText(links[1].range), 'components/card');
  assert.equal(links[1].target.fsPath, path.join(partials, 'components', 'card.hbs'));
  assert.equal(document.getText(links[2].range), 'components/button');
  assert.equal(links[2].target.fsPath, path.join(partials, 'components', 'button.hbs'));
});

test('file completion provider suggests folders and .hbs files, filters junk, and handles leading slash edit', () => {
  const { root } = makeWorkspace();
  resetMock(root);

  const completion = fresh('../dist/providers/completionProvider.js');
  const ctx = { subscriptions: [] };
  completion.register(ctx);
  const provider = vscode.__mock.registrations('completion')[0].provider;

  const rootDoc = new TestTextDocument(`{{> ''}}`);
  const rootItems = provider.provideCompletionItems(rootDoc, positionOf(rootDoc, "''", 1));
  assert.ok(rootItems.some((item) => item.label === 'components' && item.kind === vscode.CompletionItemKind.Folder));
  assert.ok(rootItems.some((item) => item.label === 'layout' && item.kind === vscode.CompletionItemKind.Folder));
  assert.equal(rootItems.some((item) => item.label === '.hidden.hbs'), false);

  const componentDoc = new TestTextDocument(`{{> 'components/'}}`);
  const componentItems = provider.provideCompletionItems(componentDoc, positionAfter(componentDoc, 'components/'));
  assert.ok(componentItems.some((item) => item.label === 'button.hbs' && item.insertText === 'button'));
  assert.ok(componentItems.some((item) => item.label === 'card.hbs' && item.insertText === 'card'));
  assert.equal(componentItems.some((item) => item.label === 'README.md'), false);

  const leadingSlashDoc = new TestTextDocument(`{{> '/components/b'}}`);
  const leadingSlashItems = provider.provideCompletionItems(leadingSlashDoc, positionAfter(leadingSlashDoc, '/components/b'));
  const button = leadingSlashItems.find((item) => item.label === 'button.hbs');
  assert.ok(button.additionalTextEdits?.length > 0);
  assert.equal(button.additionalTextEdits[0].newText, '');
});

test('file completion supports multiline and unquoted paths without escaping partial roots', () => {
  const { root, partials } = makeWorkspace();
  fs.writeFileSync(path.join(partials, 'components', 'badge.handlebars'), '<span>Badge</span>');
  fs.writeFileSync(path.join(root, 'outside.hbs'), 'outside');
  resetMock(root);

  const completion = fresh('../dist/providers/completionProvider.js');
  completion.register({ subscriptions: [] });
  const provider = vscode.__mock.registrations('completion')[0].provider;

  const multiline = new TestTextDocument(`{{>
    "components/ba"
  }}`);
  const multilineItems = provider.provideCompletionItems(multiline, positionAfter(multiline, 'components/ba'));
  assert.ok(multilineItems.some(item => item.label === 'badge.handlebars' && item.insertText === 'badge'));

  const unquoted = new TestTextDocument(`{{> components/b}}`);
  const unquotedItems = provider.provideCompletionItems(unquoted, positionAfter(unquoted, 'components/b'));
  assert.ok(unquotedItems.some(item => item.label === 'button.hbs'));

  const traversal = new TestTextDocument(`{{> "../../../out"}}`);
  const traversalItems = provider.provideCompletionItems(traversal, positionAfter(traversal, '../../../out'));
  assert.deepEqual(traversalItems, []);
});

test('param completion provider filters HBSDoc props in multiline partial calls and skips path editing', () => {
  const { root } = makeWorkspace();
  resetMock(root);

  const param = fresh('../dist/providers/paramCompletionProvider.js');
  const ctx = { subscriptions: [] };
  param.register(ctx);
  const provider = vscode.__mock.lastRegistration('completion').provider;

  const pathDoc = new TestTextDocument(`{{> 'components/b'}}`);
  assert.equal(provider.provideCompletionItems(pathDoc, positionAfter(pathDoc, 'components/b')), undefined);

  const document = new TestTextDocument(`{{> "components/button"
    dis
}}`);
  const items = provider.provideCompletionItems(document, positionAfter(document, 'dis'));
  assert.deepEqual(items.map((item) => item.label), ['disabled']);
  assert.equal(items[0].insertText.value, 'disabled=${1|true,false|}');

  const hyphenDoc = new TestTextDocument(`{{> "components/button"
    analytics-
}}`);
  const hyphenItems = provider.provideCompletionItems(hyphenDoc, positionAfter(hyphenDoc, 'analytics-'));
  assert.deepEqual(hyphenItems.map((item) => item.label), ['analytics-label']);

  const usedDoc = new TestTextDocument(`{{> "components/button"
    text="Save"
    
}}`);
  const usedItems = provider.provideCompletionItems(usedDoc, positionAfter(usedDoc, '    '));
  assert.deepEqual(usedItems.map((item) => item.label), ['disabled', 'analytics-label']);
});

test('hover provider returns component and focused parameter docs and respects config flag', () => {
  const { root } = makeWorkspace();
  resetMock(root);

  const hover = fresh('../dist/providers/hoverProvider.js');
  const ctx = { subscriptions: [] };
  hover.register(ctx);
  const provider = vscode.__mock.lastRegistration('hover').provider;
  const document = new TestTextDocument(`{{> 'components/button' text="Save" disabled=true}}`);

  const componentHover = provider.provideHover(document, positionOf(document, 'components/button'));
  assert.match(componentHover.contents.value, /### Button/);
  assert.match(componentHover.contents.value, /Reusable button/);
  assert.match(componentHover.contents.value, /text/);
  assert.match(componentHover.contents.value, /disabled/);
  assert.match(componentHover.contents.value, /Defined in: `components\/button\.hbs`/);

  const paramHover = provider.provideHover(document, positionOf(document, 'Save'));
  assert.match(paramHover.contents.value, /^\*\*text\*\*: `string`/);
  assert.match(paramHover.contents.value, /Required\./);
  assert.match(paramHover.contents.value, /Visible label/);
  assert.doesNotMatch(paramHover.contents.value, /### Button/);
  assert.doesNotMatch(paramHover.contents.value, /Reusable button/);
  assert.doesNotMatch(paramHover.contents.value, /Disabled state/);

  const booleanHover = provider.provideHover(document, positionOf(document, 'true'));
  assert.match(booleanHover.contents.value, /- `true`/);
  assert.match(booleanHover.contents.value, /- `false`/);

  const unknownDoc = new TestTextDocument(`{{> 'components/button' texxt="Save"}}`);
  const unknownHover = provider.provideHover(unknownDoc, positionOf(unknownDoc, 'texxt'));
  assert.match(unknownHover.contents.value, /Unknown parameter `texxt`/);
  assert.match(unknownHover.contents.value, /Did you mean `text`\?/);

  const summaryDoc = new TestTextDocument(`{{> 'components/card' }}`);
  const summaryHover = provider.provideHover(summaryDoc, positionOf(summaryDoc, ' }'));
  assert.match(summaryHover.contents.value, /\*\*Card\*\*/);
  assert.match(summaryHover.contents.value, /Missing required:\*\* `title`/);
  assert.doesNotMatch(summaryHover.contents.value, /### Card/);

  resetMock(root, { 'hbsMaster.enableHoverDocs': false });
  assert.equal(provider.provideHover(document, positionOf(document, 'Save')), undefined);
});

test('signature help provider exposes HBSDoc parameters and active parameter index', () => {
  const { root } = makeWorkspace();
  resetMock(root);

  const signature = fresh('../dist/providers/signatureHelpProvider.js');
  const ctx = { subscriptions: [] };
  signature.register(ctx);
  const provider = vscode.__mock.lastRegistration('signature').provider;
  const document = new TestTextDocument(`{{> 'components/button' text="Save" disabled=true}}`);

  const help = provider.provideSignatureHelp(document, positionOf(document, 'true'));
  assert.equal(help.signatures[0].label, 'Button');
  assert.deepEqual(help.signatures[0].parameters.map((p) => p.label), [
    'text: string',
    'disabled: boolean',
    'analytics-label: string',
  ]);
  assert.equal(help.activeParameter, 1);

  resetMock(root, { 'hbsMaster.enableSignatureHelp': false });
  assert.equal(provider.provideSignatureHelp(document, positionOf(document, 'true')), undefined);
});

test('highlight provider marks documented params and ignores unknown params', () => {
  const { root } = makeWorkspace();
  resetMock(root);

  const highlight = fresh('../dist/providers/highlightProvider.js');
  const ctx = { subscriptions: [] };
  highlight.register(ctx);
  const provider = vscode.__mock.lastRegistration('highlight').provider;
  const document = new TestTextDocument(`{{> 'components/button'
  text="Save"
  disabled=true
  unknown="nope"
}}
{{> 'components/button' text="Cancel"}}`);

  const textHighlights = provider.provideDocumentHighlights(document, positionOf(document, 'Save'));
  assert.equal(textHighlights.length, 2);
  assert.equal(document.getText(textHighlights[0].range), 'text');

  const unknownHighlights = provider.provideDocumentHighlights(document, positionOf(document, 'nope'));
  assert.deepEqual(unknownHighlights, []);
});

test('diagnostics provider reports unknown partials and parameter issues', () => {
  const { root } = makeWorkspace();
  resetMock(root);

  const diagnosticsProvider = fresh('../dist/providers/diagnosticsProvider.js');
  const document = new TestTextDocument(`{{> 'components/missing' title="Nope"}}
{{> 'components/button' text="Save" text="Again" bogus=true}}
{{> 'components/card'}}`);

  const diagnostics = diagnosticsProvider.collectDiagnostics(document);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    [
      'Unknown partial: components/missing',
      'Duplicate parameter: text',
      'Unknown parameter "bogus" for partial components/button',
      'Missing required parameter "title" for partial components/card',
    ]
  );

  resetMock(root, { 'hbsMaster.enableDiagnostics': false });
  assert.deepEqual(diagnosticsProvider.collectDiagnostics(document), []);
});

test('diagnostics provider supports severity config', () => {
  const { root } = makeWorkspace();
  resetMock(root, { 'hbsMaster.diagnosticsSeverity': 'error' });

  const diagnosticsProvider = fresh('../dist/providers/diagnosticsProvider.js');
  const document = new TestTextDocument(`{{> 'components/missing'}}`);
  const diagnostics = diagnosticsProvider.collectDiagnostics(document);

  assert.equal(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
  assert.equal(diagnostics[0].source, 'HBS Master');
  assert.equal(diagnostics[0].code, 'hbs-master.unknownPartial');
});

test('code action provider creates quick fixes for diagnostics', () => {
  const { root } = makeWorkspace();
  resetMock(root);

  const diagnosticsProvider = fresh('../dist/providers/diagnosticsProvider.js');
  const codeActions = fresh('../dist/providers/codeActionProvider.js');
  const document = new TestTextDocument(`{{> 'components/missing'}}
{{> 'components/button' text="Save" text="Again" bogus=true}}
{{> 'components/card'}}`);
  const diagnostics = diagnosticsProvider.collectDiagnostics(document);

  const unknownPartial = diagnostics.find(diagnostic => diagnostic.code === 'hbs-master.unknownPartial');
  const createActions = codeActions.createCodeActions(document, unknownPartial.range, [unknownPartial]);
  assert.equal(createActions[0].title, 'Create partial "components/missing"');
  assert.equal(createActions[0].command.command, 'hbsMaster.createPartial');

  const duplicate = diagnostics.find(diagnostic => diagnostic.code === 'hbs-master.duplicateParameter');
  const removeActions = codeActions.createCodeActions(document, duplicate.range, [duplicate]);
  assert.equal(removeActions[0].title, 'Remove parameter "text"');
  assert.equal(removeActions[0].edit.operations[0].type, 'delete');

  const missing = diagnostics.find(diagnostic => diagnostic.code === 'hbs-master.missingRequiredParameter');
  const addActions = codeActions.createCodeActions(document, missing.range, [missing]);
  assert.equal(addActions[0].title, 'Add required parameter "title"');
  assert.equal(addActions[0].edit.operations[0].newText, ' title="string"');
});

test('extension activation wires every provider and document watcher', () => {
  const { root } = makeWorkspace();
  resetMock(root);

  const extension = fresh('../dist/extension.js');
  const ctx = { subscriptions: [] };
  extension.activate(ctx);

  assert.equal(vscode.__mock.registrations('definition').length, 1);
  assert.equal(vscode.__mock.registrations('link').length, 1);
  assert.equal(vscode.__mock.registrations('hover').length, 1);
  assert.equal(vscode.__mock.registrations('signature').length, 1);
  assert.equal(vscode.__mock.registrations('highlight').length, 1);
  assert.equal(vscode.__mock.registrations('codeAction').length, 1);
  assert.equal(vscode.__mock.registrations('completion').length, 2);
  assert.equal(vscode.__mock.state.registeredCommands.some((command) => command.command === 'hbsMaster.createPartial'), true);
  assert.equal(vscode.__mock.state.watchers.length, 1);
  assert.equal(vscode.__mock.state.diagnostics.length, 0);
  assert.ok(vscode.__mock.state.logs.some((line) => line.includes('HBS Master activated!')));
});
