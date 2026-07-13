const test = require('node:test');
const assert = require('node:assert/strict');
const { installVscodeMock, vscode } = require('./support/vscode-mock.cjs');
const { TestTextDocument, positionOf, positionAfter } = require('./support/text-document.cjs');

installVscodeMock();
const { HbsDocParser } = require('../dist/hbs-doc-parser.js');

test('parseHbsDoc returns null when file has no HBSDoc block', () => {
  assert.equal(HbsDocParser.parseHbsDoc('<button>{{text}}</button>'), null);
});

test('parseHbsDoc skips regular comments and supports components without params', () => {
  const info = HbsDocParser.parseHbsDoc(`{{!-- just an implementation note --}}
{{!--
  @name Icon
  @description Decorative icon without public parameters.
--}}
<svg></svg>`);

  assert.ok(info);
  assert.equal(info.name, 'Icon');
  assert.equal(info.description, 'Decorative icon without public parameters.');
  assert.deepEqual(info.properties, []);
});

test('parseHbsDoc parses component metadata, scalar params, defaults and aliases', () => {
  const info = HbsDocParser.parseHbsDoc(`{{!--
    @name Hero Button
    @description Main CTA used in landing pages.
    @description Supports icons and analytics labels.

    @parameters
    @description Visible label
    text: string;

    @description Native button type
    @default "button"
    type?: "button" | "submit" | "reset";

    @description ARIA label
    aria-label?: string;

    @description Disabled state
    disabled?: boolean;

    @type
    ButtonAnalytics: {
      event: string;
      payload?: string;
    }
  --}}
  <button>{{text}}</button>`);

  assert.ok(info);
  assert.equal(info.name, 'Hero Button');
  assert.equal(info.description, 'Main CTA used in landing pages. Supports icons and analytics labels.');
  assert.deepEqual(
    info.properties.map((property) => ({
      name: property.name,
      optional: property.optional,
      type: property.type,
      description: property.description,
      defaultValue: property.defaultValue,
    })),
    [
      { name: 'text', optional: false, type: 'string', description: 'Visible label', defaultValue: undefined },
      { name: 'type', optional: true, type: '"button" | "submit" | "reset"', description: 'Native button type', defaultValue: 'button' },
      { name: 'aria-label', optional: true, type: 'string', description: 'ARIA label', defaultValue: undefined },
      { name: 'disabled', optional: true, type: 'boolean', description: 'Disabled state', defaultValue: undefined },
    ]
  );
  assert.deepEqual(info.types, [{ name: 'ButtonAnalytics', body: '{\nevent: string\npayload?: string\n}' }]);
});

test('parseHbsDoc supports @params alias and tolerates @parametrs typo used by existing projects', () => {
  const paramsInfo = HbsDocParser.parseHbsDoc(`{{!--
    @name Cookie modal
    @params
    @description Cookie value from backend
    accepted: "required-only" | "all" | "";
  --}}`);
  const typoInfo = HbsDocParser.parseHbsDoc(`{{!--
    @name Cookie modal
    @parametrs
    @description Cookie value from backend
    accepted: "required-only" | "all" | "";
    @note
    Implementation note that should not hide params.
  --}}`);

  for (const info of [paramsInfo, typoInfo]) {
    assert.ok(info);
    assert.equal(info.name, 'Cookie modal');
    assert.equal(info.properties.length, 1);
    assert.equal(info.properties[0].name, 'accepted');
    assert.equal(info.properties[0].type, '"required-only" | "all" | ""');
  }
});

test('parseHbsDoc preserves multiline object and object-array parameter shapes', () => {
  const info = HbsDocParser.parseHbsDoc(`{{!--
    @name Catalog
    @parameters
    @description Cards to render
    items: {
      @description Card title
      title: string;
      @description Nested link
      link?: {
        href: string;
        target?: "_blank" | "_self";
      };
    }[]
  --}}`);

  assert.ok(info);
  assert.equal(info.properties.length, 1);
  assert.equal(info.properties[0].name, 'items');
  assert.equal(info.properties[0].description, 'Cards to render');
  assert.match(info.properties[0].type, /^\{\n\/\/ Card title\ntitle: string/);
  assert.match(info.properties[0].type, /link\?: \{\nhref: string/);
  assert.match(info.properties[0].type, /\}\[\]$/);
});

test('parseHbsDoc handles case-insensitive tags, inline comments, and consecutive aliases', () => {
  const info = HbsDocParser.parseHbsDoc(`{{!--
    @NAME Alert
    @DESCRIPTION Status message.
    @PARAMETERS
    @DESCRIPTION Visual tone
    tone?: "info" | "warning"; // optional tone
    @TYPE Tone: "info" | "warning";
    @TYPE Payload: {
      value: string;
    }
  --}}`);

  assert.equal(info.name, 'Alert');
  assert.equal(info.description, 'Status message.');
  assert.equal(info.properties[0].type, '"info" | "warning"');
  assert.deepEqual(info.types.map(type => type.name), ['Tone', 'Payload']);
  assert.equal(info.types[0].body, '"info" | "warning"');
  assert.match(info.types[1].body, /value: string/);
});

test('createHoverInfo renders scalar props, nested object props and alias code blocks', () => {
  const info = HbsDocParser.parseHbsDoc(`{{!--
    @name Catalog
    @description Catalog component.
    @parameters
    @description Heading text
    title: string;
    @description Cards to render
    items: {
      @description Card title
      title: string;
      url?: string;
    }[]
    @type
    StringHTML: string
  --}}`);

  const hover = HbsDocParser.createHoverInfo(info);
  assert.equal(hover.isTrusted, false);
  assert.match(hover.value, /### Catalog/);
  assert.match(hover.value, /Catalog component\./);
  assert.match(hover.value, /\*\*title\*\*: `string` _\(required\)_ — Heading text/);
  assert.match(hover.value, /\*\*items\*\*: Object\[\] _\(required\)_ — Cards to render/);
  assert.match(hover.value, /- \*\*title\*\*: `string` — Card title/);
  assert.match(hover.value, /\*\*Type aliases:\*\*/);
  assert.match(hover.value, /```ts\nStringHTML: string/);
});

test('createHoverInfo preserves nested object-array shapes', () => {
  const info = HbsDocParser.parseHbsDoc(`{{!--
    @name Grid
    @parameters
    groups: {
      cards: {
        title: string;
      }[]
    };
  --}}`);
  const hover = HbsDocParser.createHoverInfo(info);

  assert.match(hover.value, /\*\*cards\*\*: Object\[\]/);
});

test('parameter and unknown parameter hover render focused UX details', () => {
  const info = HbsDocParser.parseHbsDoc(`{{!--
    @name Cookie modal
    @description Full component description that should not appear in parameter hover.
    @parameters
    @description Cookie value from backend
    accepted: "required-only" | "all" | "";
    @description Optional close button
    closable?: boolean;
    @description Link list
    links?: LinkData[];
    @type
    LinkData: {
      text: string;
      href: string;
    }
  --}}`);

  const accepted = info.properties.find(property => property.name === 'accepted');
  const acceptedHover = HbsDocParser.createParameterHoverInfo(info, accepted, {
    source: 'sections/cookie-modal/cookie-modal.hbs',
  });

  assert.match(acceptedHover.value, /^\*\*accepted\*\*: `"required-only" \| "all" \| ""`/);
  assert.match(acceptedHover.value, /Required\./);
  assert.match(acceptedHover.value, /Cookie value from backend/);
  assert.match(acceptedHover.value, /\*\*Allowed values:\*\*/);
  assert.match(acceptedHover.value, /- `"required-only"`/);
  assert.match(acceptedHover.value, /- `""`/);
  assert.match(acceptedHover.value, /Defined in: `sections\/cookie-modal\/cookie-modal\.hbs`/);
  assert.doesNotMatch(acceptedHover.value, /Full component description/);
  assert.doesNotMatch(acceptedHover.value, /Optional close button/);

  const closable = info.properties.find(property => property.name === 'closable');
  const booleanHover = HbsDocParser.createParameterHoverInfo(info, closable);
  assert.match(booleanHover.value, /Optional\./);
  assert.match(booleanHover.value, /- `true`/);
  assert.match(booleanHover.value, /- `false`/);

  const links = info.properties.find(property => property.name === 'links');
  const aliasHover = HbsDocParser.createParameterHoverInfo(info, links);
  assert.match(aliasHover.value, /```ts\nLinkData: \{/);

  const unknownHover = HbsDocParser.createUnknownParameterHoverInfo('acccepted', info, {
    componentPath: 'sections/cookie-modal/cookie-modal',
  });
  assert.match(unknownHover.value, /Unknown parameter/);
  assert.match(unknownHover.value, /Did you mean `accepted`\?/);
  assert.match(unknownHover.value, /Known parameters: `accepted`, `closable`, `links`/);
});

test('createCompletionItems builds snippets and markdown docs for params', () => {
  const items = HbsDocParser.createCompletionItems({
    name: 'Button',
    properties: [
      { name: 'disabled', type: 'boolean', description: 'Disable button', optional: true },
      { name: 'text', type: 'string', description: 'Visible label', optional: false, defaultValue: 'OK' },
    ],
    types: [],
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].label, 'disabled');
  assert.equal(items[0].kind, vscode.CompletionItemKind.Property);
  assert.equal(items[0].insertText.value, 'disabled=${1|true,false|}');
  assert.equal(items[1].insertText.value, 'text="${1:OK}"');
  assert.match(items[1].documentation.value, /Visible label/);
  assert.match(items[1].documentation.value, /OK/);
});

test('createCompletionItems uses type-aware editable snippets', () => {
  const items = HbsDocParser.createCompletionItems({
    properties: [
      { name: 'variant', type: "'primary' | 'secondary'", description: '', optional: true },
      { name: 'count', type: 'number', description: '', optional: true },
      { name: 'items', type: 'ItemData[]', description: '', optional: true },
      { name: 'mixed', type: 'boolean | string', description: '', optional: true },
    ],
    types: [],
  });

  assert.deepEqual(items.map(item => item.insertText.value), [
    'variant="${1|primary,secondary|}"',
    'count=${1:0}',
    'items=${1}',
    'mixed=${1}',
  ]);
  assert.equal(items.every(item => item.detail.includes('HBSDoc parameter')), true);
});

test('component helpers understand multiline partials, quote styles and cursor boundaries', () => {
  const document = new TestTextDocument(`<main>
  {{> "components/card"
      title="Hello"
      aria-label="Card aria"
  }}
  after close
</main>`);

  assert.equal(HbsDocParser.isInsideComponentTag(document, positionOf(document, 'title="Hello"')), true);
  assert.equal(HbsDocParser.isInsideComponentTag(document, positionAfter(document, 'after close')), false);
  assert.equal(HbsDocParser.isInsideComponentTag(document, positionAfter(document, '  }}')), false);
  assert.equal(HbsDocParser.getComponentNameAtPosition(document, positionOf(document, 'aria-label')), 'components/card');
  assert.equal(HbsDocParser.getCurrentParameter(document, positionOf(document, 'Card aria', 2)), 'aria-label');
});

test('component helpers understand unquoted and block partials and parameter-name positions', () => {
  const document = new TestTextDocument(`<main>
  {{#> components/card
      title="Hello"
  }}
    fallback
  {{/components/card}}
</main>`);

  assert.equal(HbsDocParser.isInsideComponentTag(document, positionOf(document, 'title')), true);
  assert.equal(HbsDocParser.getComponentNameAtPosition(document, positionOf(document, 'components/card')), 'components/card');
  assert.equal(HbsDocParser.getCurrentParameter(document, positionOf(document, 'title')), 'title');
});

test('partial scanner handles closing whitespace control without stalling', () => {
  const document = new TestTextDocument(`{{~> components/button text="Save" disabled=true~}}`);
  const partials = require('../dist/utils/partials.js');

  const invocation = partials.findPartialInvocations(document)[0];
  assert.ok(invocation);
  assert.equal(invocation.component, 'components/button');
  assert.equal(document.offsetAt(invocation.fullRange.end), document.getText().length);
  assert.equal(document.getText().slice(invocation.hashEndOffset), '~}}');

  const pairs = partials.getHashPairs(document, invocation);
  assert.deepEqual(pairs.map(pair => pair.name), ['text', 'disabled']);
  assert.equal(document.getText(pairs[1].valueRange), 'true');
});

test('partial scanner always advances over malformed hash input', () => {
  const document = new TestTextDocument(`{{> components/button ~~ text="Save"}}`);
  const partials = require('../dist/utils/partials.js');
  const invocation = partials.findPartialInvocations(document)[0];

  assert.ok(invocation);
  assert.deepEqual(partials.getHashPairs(document, invocation).map(pair => pair.name), ['text']);
});

test('partial scanner indexes inline partial definitions with lexical scope', () => {
  const document = new TestTextDocument(`{{#if enabled}}
  {{#*inline "badge"}}Badge{{/inline}}
  {{> badge}}
{{/if}}`);
  const partials = require('../dist/utils/partials.js');
  const definitions = partials.findInlinePartialDefinitions(document);

  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].name, 'badge');
  assert.equal(document.getText(definitions[0].nameRange), 'badge');
  assert.equal(
    partials.getVisibleInlinePartialDefinition(document, 'badge', positionOf(document, '{{> badge', 4)).name,
    'badge'
  );
});

test('partial scanner survives a deterministic malformed-input corpus', () => {
  const partials = require('../dist/utils/partials.js');
  const alphabet = ` abcXYZ09_-~='"()[]{}|/@`;
  let seed = 0x5eed1234;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };

  for (let iteration = 0; iteration < 400; iteration++) {
    const length = random() % 80;
    let hash = '';
    for (let index = 0; index < length; index++) hash += alphabet[random() % alphabet.length];

    const document = new TestTextDocument(`before {{> component ${hash}}} after`);
    for (const invocation of partials.findPartialInvocations(document)) {
      const start = document.offsetAt(invocation.fullRange.start);
      const end = document.offsetAt(invocation.fullRange.end);
      assert.ok(start >= 0 && end > start && end <= document.getText().length);

      for (const pair of partials.getHashPairs(document, invocation)) {
        const pairStart = document.offsetAt(pair.fullRange.start);
        const pairEnd = document.offsetAt(pair.fullRange.end);
        assert.ok(pairStart >= invocation.hashStartOffset);
        assert.ok(pairEnd >= pairStart && pairEnd <= invocation.hashEndOffset);
      }
    }
  }
});
