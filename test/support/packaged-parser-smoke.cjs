const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { installVscodeMock } = require('./vscode-mock.cjs');
const { TestTextDocument } = require('./text-document.cjs');

installVscodeMock();

const extensionRoot = fs.realpathSync(path.resolve(process.argv[2]));
const extensionRequire = createRequire(path.join(extensionRoot, 'package.json'));

// Import the public entry point explicitly. HBS Master's tolerant scanner would
// otherwise conceal a missing packaged dependency by silently skipping the AST.
const parser = extensionRequire('@poliklot/prettier-plugin-handlebars').parsers.handlebars;
assert.equal(typeof parser.parse, 'function');
assert.equal(typeof parser.locStart, 'function');
assert.equal(typeof parser.locEnd, 'function');
for (const dependency of ['@poliklot/prettier-plugin-handlebars', 'template-format-core', 'prettier', 'prettier/plugins/babel']) {
  const relative = path.relative(extensionRoot, extensionRequire.resolve(dependency));
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `${dependency} must resolve inside the packaged extension`);
}

const partials = extensionRequire('./dist/utils/partials.js');
const source = [
  '{{!-- {{> comment-only}} --}}',
  '<script data-label="a > b">const html = "<style>not an HTML element</style>";</script>',
  '<div {{> attributes enabled=true}}></div>',
  '{{#if show}}',
  '  {{#*inline "local"}}Local{{/inline}}',
  '  {{> local}}',
  '{{/if}}',
  '{{> local}}',
  '{{~> real value="kept" ~}}',
].join('\n');
const document = new TestTextDocument(source);
const ast = parser.parse(source);
assert.equal(ast.type, 'Program');
assert.equal(parser.locStart(ast), 0);
assert.equal(parser.locEnd(ast), source.length);

const calls = partials.findPartialInvocations(document);
assert.deepEqual(calls.map(call => call.component), ['attributes', 'local', 'local', 'real']);
for (const call of calls) {
  assert.equal(document.getText(call.componentRange), call.component);
  assert.match(document.getText(call.fullRange), /^\{\{~?>/);
}
assert.ok(partials.getVisibleInlinePartialDefinition(document, 'local', calls[1].componentRange.start));
assert.equal(partials.getVisibleInlinePartialDefinition(document, 'local', calls[2].componentRange.start), undefined);
const pairs = partials.getHashPairs(document, calls[3]);
assert.equal(pairs.length, 1);
assert.equal(pairs[0].name, 'value');
assert.equal(document.getText(pairs[0].valueRange), '"kept"');

console.log('Packaged parser imports, AST filtering, ranges and inline scopes passed.');
