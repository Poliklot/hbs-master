# HBS Master

VS Code tooling for productive work with classic Handlebars (`.hbs`) templates.

HBS Master helps you navigate partials, document component APIs with HBSDoc, autocomplete component parameters, and catch common template mistakes before runtime.

## Features

- **Partial path completion**: smart path suggestions for `{{> '...'}}`, including nested folders.
- **Go to partial definition**: jump to partial files with Ctrl/Cmd+Click or F12.
- **Parameter completion**: autocomplete documented component parameters from HBSDoc.
- **AST-backed partial discovery**: Handlebars parsing via `@poliklot/prettier-plugin-handlebars` with precise ranges for paths and parameters.
- **Hover documentation**: show full component docs on the partial path and compact, focused docs on individual parameters.
- **Signature help**: display component parameters while editing partial calls.
- **Parameter highlighting**: highlight matching parameters in partial calls.
- **Diagnostics**: warnings/errors for unknown partials, unknown parameters, duplicate parameters, and missing required parameters.
- **Quick Fixes**:
  - create a missing partial;
  - remove an unknown parameter;
  - remove a duplicate parameter;
  - add a missing required parameter.

## Usage

### Partial navigation

```handlebars
{{> 'components/button' text="Click me"}}
```

Place the cursor on the partial path and use:

- Ctrl+Click / Cmd+Click;
- or F12 / Go to Definition.

### Supported partial forms

HBS Master supports static partial names:

```handlebars
{{> 'components/button'}}
{{> "components/button"}}
{{> components/button}}

{{#> components/card title="Card title"}}
  fallback content
{{/components/card}}

<div {{> components/attributes id="hero"}}></div>
```

If `components/panel.hbs` does not exist, HBS Master also tries `components/panel/index.hbs`.

Dynamic partials cannot be resolved statically and are intentionally ignored:

```handlebars
{{> (lookup . "partialName")}}
```

### Hover behavior

- Hover the partial path (`components/button`) to see the component description, all documented parameters, missing required parameters in the current call, and the source file.
- Hover a parameter name or value (`text="Click me"`) to see only that parameter: type, required/optional status, default value, allowed union/boolean values, aliases, and the source file.
- Hover an undocumented parameter to see an “unknown parameter” message with the nearest documented parameter suggestion when available.

## HBSDoc

Add an HBSDoc block near the top of a partial file to describe a component and its parameters.

```handlebars
{{!--
    @name Button
    @description A reusable button with configurable text and native type.

    @parameters

    @description Visible button label.
    text: string;

    @description Native button type.
    @default "button"
    type?: 'button' | 'submit' | 'reset';

    @description Disable the button.
    disabled?: boolean;
--}}

<button
    type="{{type}}"
    {{#if disabled}}
        disabled
    {{/if}}
>
  {{text}}
</button>
```

### HBSDoc tags

- `@name`: human-readable component name.
- `@description`: component or next-parameter description.
- `@parameters` / `@params`: starts the parameter section. The common legacy typo `@parametrs` is tolerated for existing projects.
- `@default`: parameter default value.
- `@type`: alias type definition for complex component API shapes.

Parameter syntax:

```hbs
requiredName: string;
optionalName?: string;
items: ItemData[];
```

See [HBSDoc-spec.md](./HBSDoc-spec.md) for the full specification.

## Settings

- `hbsMaster.partialsPath`: partials directory relative to the workspace root. Default: `src/partials`.
- `hbsMaster.enableHoverDocs`: enable hover documentation. Default: `true`.
- `hbsMaster.enableSignatureHelp`: enable signature help. Default: `true`.
- `hbsMaster.enableParameterHighlight`: enable parameter highlighting. Default: `true`.
- `hbsMaster.enableDiagnostics`: enable partial and parameter diagnostics. Default: `true`.
- `hbsMaster.diagnosticsSeverity`: diagnostic severity: `hint`, `information`, `warning`, or `error`. Default: `warning`.

Example workspace settings:

```json
{
  "hbsMaster.partialsPath": "components",
  "hbsMaster.diagnosticsSeverity": "warning"
}
```

## Requirements

- VS Code `1.101.0` or newer.
- `.hbs` files must use the `handlebars` language id.

## Testing a local VSIX build

Build the extension:

```bash
npm run package
```

Install the generated `.vsix` in VS Code:

1. Open VS Code.
2. Open the Extensions view.
3. Click `...` in the Extensions view toolbar.
4. Select `Install from VSIX...`.
5. Choose `hbs-master-1.0.0.vsix`.

Or install from the command line:

```bash
code --install-extension hbs-master-1.0.0.vsix
```

After installing, open a project with `.hbs` files and configure `hbsMaster.partialsPath` if your partials are not under `src/partials`.

## Development

```bash
npm ci
npm test
npm run test:integration
npm run package
```

- `npm test` runs TypeScript compilation and unit tests.
- `npm run test:integration` runs a VS Code Extension Development Host smoke test.
- `npm run package` compiles the extension and builds the `.vsix`.

## Known limitations

- Dynamic partials such as `{{> (lookup . "partialName")}}` are not resolved because the target file name is only known at runtime.
- Diagnostics and completions are based on HBSDoc comments. Undocumented partials can still be navigated to, but parameter intelligence is unavailable.
- HBS Master targets classic Handlebars templates and static partial calls.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
