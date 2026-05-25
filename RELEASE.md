# Release checklist

## 1.0.0 readiness

Перед публикацией `1.0.0` проверьте:

- [ ] `CHANGELOG.md` содержит секцию `1.0.0` с пользовательскими изменениями.
- [ ] `package.json` version обновлён до `1.0.0`.
- [ ] `README.md` описывает актуальный синтаксис partials, HBSDoc, diagnostics и настройки.
- [ ] `HBSDoc-spec.md` соответствует фактическому parser behavior.
- [ ] `npm ci` проходит на чистом checkout.
- [ ] `npm test` проходит.
- [ ] `npm run test:integration` проходит на smoke workspace.
- [ ] `npx tsc --noEmit --noUnusedLocals --noUnusedParameters --noImplicitReturns` проходит.
- [ ] `npm audit --audit-level=high` проходит.
- [ ] `npm run package` собирает VSIX без `src/`, `test/`, `.vscode/`, локальных итераций и мусора.
- [ ] VSIX установлен вручную в чистый VS Code Extension Development Host.
- [ ] Проверены основные сценарии:
  - [ ] path completion для partials;
  - [ ] go to definition / document link;
  - [ ] hover component docs;
  - [ ] parameter completion без уже указанных props;
  - [ ] signature help;
  - [ ] parameter highlight;
  - [ ] diagnostics: unknown partial / unknown prop / duplicate prop / missing required prop.

## Команды

```bash
npm ci
npm test
npm run test:integration
npx tsc --noEmit --noUnusedLocals --noUnusedParameters --noImplicitReturns
npm audit --audit-level=high
npm run package
```

## Публикация

```bash
npm version 1.0.0 --no-git-tag-version
npm run package
npm run publish
```

После публикации:

- [ ] Создать git tag `v1.0.0`.
- [ ] Создать GitHub Release с VSIX artifact.
- [ ] Проверить Marketplace page и install flow.
