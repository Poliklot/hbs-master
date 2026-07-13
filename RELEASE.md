# Release checklist

## 1.1.0 readiness

Before publishing `1.1.0`, verify:

- [x] `CHANGELOG.md` contains user-facing `1.1.0` release notes.
- [x] `package.json` and `package-lock.json` use version `1.1.0`.
- [x] `README.md` documents current partial syntax, HBSDoc behavior, diagnostics, settings, and limitations.
- [x] `HBSDoc-spec.md` matches the parser behavior.
- [x] `npm ci` succeeds from the lockfile.
- [x] `npm test` succeeds.
- [x] `npm run test:integration` succeeds in the smoke workspace.
- [x] The strict TypeScript check succeeds.
- [x] `npm audit --audit-level=high` reports no high-severity vulnerabilities.
- [x] `npm run package` creates a VSIX without sources, tests, source maps, declarations, local files, or development-only CLI helpers.
- [x] The VSIX installs into an isolated VS Code extensions directory.
- [ ] GitHub Actions checks succeed on Linux, macOS, and Windows.
- [ ] The final Marketplace version and GitHub Release are both `1.1.0`.

## Local verification

```bash
npm ci
npm test
npm run test:integration
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --noImplicitReturns
npm audit --audit-level=high
npm run package
```

Verify the main editor scenarios through the extension-host suite:

- quoted, unquoted, multiline, nested, and `.handlebars` path completion;
- file and inline-partial definition navigation;
- component and parameter hover documentation;
- parameter completion without duplicate suggestions;
- Signature Help and parameter highlighting;
- diagnostics for unknown partials, unknown parameters, duplicate parameters, and missing required parameters;
- safe creation of a missing partial and caller diagnostic refresh.

## Publication order

1. Merge the fully green pull request into `master`.
2. Build and inspect `hbs-master-1.1.0.vsix` from the merged commit.
3. Publish version `1.1.0` to the VS Code Marketplace.
4. Create tag `v1.1.0` and one GitHub Release containing the verified VSIX.
5. Verify the Marketplace page and a clean install.
