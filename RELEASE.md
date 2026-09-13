# Release checklist

## 1.1.1 readiness

This checklist records release preparation, not proof of Marketplace publication.
Local checks below were run on macOS arm64. Live merge and publication status is
tracked in [#13](https://github.com/Poliklot/hbs-master/issues/13) and the
[GitHub Release](https://github.com/Poliklot/hbs-master/releases/tag/v1.1.1).

- [x] `CHANGELOG.md` contains user-facing `1.1.1` notes dated `2026-09-13`.
- [x] `package.json` and `package-lock.json` use version `1.1.1`.
- [x] The bundled Handlebars plugin is exactly `0.4.1`; the lockfile resolves `template-format-core` `0.2.0`.
- [x] `npm ci` succeeds with a fresh npm cache.
- [x] All 42 tests pass on Node 22 and 24, including an isolated copy of the VSIX file set.
- [x] The strict TypeScript check succeeds.
- [x] `npm audit --audit-level=high` reports zero vulnerabilities.
- [x] The extension-host suite passes on the minimum supported VS Code `1.101.0`.
- [x] The extension-host suite passes on current stable VS Code `1.137.0`.
- [x] The actual VSIX contains the required runtime dependencies, without sources, tests, source maps, declarations, local files, or development-only CLI helpers.
- [x] The VSIX installs into an isolated extensions directory and passes the extension-host suite on VS Code `1.101.0` from that installed directory.
- [x] The actual VSIX passes the extension-host suite on current stable VS Code `1.137.0`.
- [x] GitHub Actions checks succeed for [PR #14](https://github.com/Poliklot/hbs-master/pull/14) on Linux, macOS, and Windows; rerun them after any final preparation changes before merge.
- [ ] The fully green PR is merged and the release VSIX is rebuilt from the merged commit.
- [ ] The final Marketplace version and GitHub Release are both `1.1.1`.

## Why the VSIX includes Prettier

HBS Master uses the plugin's public entry point to obtain its AST parser. The
`0.4.1` entry point also loads the shared core's optional Prettier adapter, which
requires `prettier` and `prettier/plugins/babel`. Keeping only `prettier/doc.js`
made source-tree tests pass while the packaged extension silently fell back to
its scanner after a `MODULE_NOT_FOUND` error.

Keep the complete Prettier runtime dependency tree, excluding only development
declarations, documentation and its CLI. The VSIX is larger (about 2.81 MiB), but
does not depend on the user's workspace or another installed extension. A future
public parser-only export in the upstream plugin could reduce the payload; do
not bypass package exports with a private `dist/parser.js` import or maintain a
fragile per-file runtime allowlist. No formatting provider is added to HBS Master.

## Local verification

```bash
npm ci
npm test
npx --no-install tsc --noEmit --noUnusedLocals --noUnusedParameters --noImplicitReturns
npm audit --audit-level=high
VSCODE_TEST_VERSION=1.101.0 npm run test:integration
VSCODE_TEST_VERSION=stable npm run test:integration
npm run package
```

`npm test` uses VSCE's public file-list API to copy only the packaged file set
into a temporary directory. A separate process must load the real parser and
verify comment filtering, exact source ranges and lexical inline-partial scope.
This catches missing dependencies that the normal scanner fallback would hide.

The extension-host suite also covers navigation after script bodies, ignored
Handlebars comments, scoped inline partials, completion, HBSDoc, diagnostics and
Quick Fixes. Test editor profiles and writable workspaces are temporary and do
not modify the user's installed extensions or settings.

To repeat those editor checks against the **actual VSIX**, extract it outside
the source checkout (so ancestor `node_modules` cannot fill missing files):

```bash
PACKAGED_ROOT="$(mktemp -d)"
python3 -m zipfile -e hbs-master-1.1.1.vsix "$PACKAGED_ROOT"
HBS_MASTER_EXTENSION_PATH="$PACKAGED_ROOT/extension" VSCODE_TEST_VERSION=stable npm run test:integration
```

The runner asserts the extension path, preventing accidental verification of a
different installed/source-tree copy. CI runs the packaged-extension check too.

## Related work and merge order

- HBS Master tracking and acceptance: [#13](https://github.com/Poliklot/hbs-master/issues/13).
- Shared-core migration: [template-format-core #2](https://github.com/Poliklot/template-format-core/issues/2).
- Handlebars integration: [plugin #82](https://github.com/Poliklot/prettier-plugin-handlebars/pull/82).
- Published Handlebars `0.4.1`: [release #83](https://github.com/Poliklot/prettier-plugin-handlebars/pull/83).
- Build-only audit fix: [Dependabot #12](https://github.com/Poliklot/hbs-master/pull/12). It was merged before [implementation #14](https://github.com/Poliklot/hbs-master/pull/14); the identical three-line `js-yaml` lockfile update merged without conflicts. No direct dependency was added and no broad audit fix was run.

## Publication order

1. Complete remote checks and merge the PR into `master`.
2. Confirm the prepared changelog date is the actual release date.
3. Build and inspect `hbs-master-1.1.1.vsix` from the final merged release commit.
4. Publish the **verified VSIX** as `poliklot.hbs-master` `1.1.1` to the VS Code Marketplace.
5. Create tag `v1.1.1` and one GitHub Release containing that same VSIX.
6. Verify the Marketplace version and a clean install. Preparing or testing this candidate does not publish it.
