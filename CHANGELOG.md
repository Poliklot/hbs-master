# Changelog

## [1.1.0] - 2026-07-13

### Added
- Added ordered multi-root partial lookup through `hbsMaster.partialsPaths`, with resource-scoped configuration for multi-folder workspaces.
- Added first-class `.handlebars` support alongside `.hbs` for completion, navigation, diagnostics, file watching, and packaging metadata.
- Added scoped inline partial definition support for navigation and missing-partial diagnostics.
- Added recognition for the Handlebars runtime partial `@partial-block`.
- Added limited untrusted-workspace support while disabling file-creating Quick Fixes.

### Fixed
- Prevented malformed whitespace-control partial expressions from stalling the scanner.
- Hardened partial path resolution against traversal, lexical-prefix confusion, and symlink escapes.
- Fixed completion for quoted, unquoted, multiline, nested, and cursor-adjacent partial paths.
- Fixed stale HBSDoc, diagnostics, and editor-provider state after document, partial file, or configuration changes.
- Fixed Signature Help labels and active-parameter ranges to follow the VS Code API contract.
- Fixed Quick Fix edits around whitespace-control delimiters, multiline calls, default values, and concurrent file creation.
- Fixed HBSDoc parsing for case-insensitive tags, inline comments, consecutive aliases, and nested object-array types.

### Improved
- Improved parameter snippets for booleans, string unions, numbers, arrays, and object expressions.
- Improved repeated filesystem lookup performance with per-component caching and targeted invalidation.
- Updated `@poliklot/prettier-plugin-handlebars` to `0.3.2` and refreshed the TypeScript, VS Code, and packaging toolchain.
- Reduced the VSIX payload by excluding source maps, declarations, CLI helpers, and dependency documentation.
- Expanded unit, malformed-input, extension-host, multi-platform CI, and packaged-extension smoke coverage.

## [1.0.0] - 2026-05-25

### Fixed
- Исправлена упаковка VSIX: перед упаковкой выполняется компиляция, а локальные файлы, исходники и тесты исключаются через `.vscodeignore`.
- Исправлена навигация и document links для multiline, double-quoted, unquoted, block и attribute partials.
- Исправлено автодополнение параметров: уже указанные параметры больше не предлагаются повторно.
- Исправлена инвалидация кеша HBSDoc при изменении настроек `hbsMaster`.
- Исправлен hover по параметру partial-вызова: теперь показывается только документация конкретного параметра, а не весь компонент.
- Добавлена терпимость к legacy-опечатке `@parametrs` в HBSDoc.

### Improved
- Добавлены диагностики unknown partial / unknown parameter / duplicate parameter / missing required parameter.
- Добавлены Quick Fixes для создания missing partial, удаления unknown/duplicate параметров и добавления обязательных параметров.
- Улучшены hover-подсказки: full component hover на path, compact parameter hover на hash-параметрах, unknown parameter suggestions, required/optional/default, allowed union/boolean values, alias expansion, source file и missing required summary.
- Добавлена настройка severity для диагностик.
- Добавлен кеш разбора partial-вызовов и debounce диагностик.
- Добавлена поддержка `index.hbs` fallback для partial-путей.
- Подключен AST parser из `@poliklot/prettier-plugin-handlebars`, а общий scanner используется для точных ranges partial-вызовов и hash-параметров.
- Актуализированы README и HBSDoc specification под текущий синтаксис.
- Оптимизирован размер иконки расширения.
- Добавлен GitHub Actions CI для test, strict TypeScript check, dependency audit, integration smoke и VSIX package.
- Добавлен VS Code integration smoke test и `RELEASE.md` checklist для подготовки `1.0.0`.

## [0.2.0] - 2025-07-10

### Added
- Добавлена спецификация для [HBSDoc](./HBSDoc-spec.md)
- Добавлены типы в описани компонента

### Improved
- Улучшен разбор документации

### Changed
- Изменен синтаксис написания HBSDoc.

## [0.1.0] - 2025-07-10

### Added
- Полноценное автодополнение для путей partials (`{{> '...'}}`)

### Improved
- Монолит разобран по модулям

## [0.0.3] - 2025-06-24

### Fixed
- Исправлена проблема из-за неправильного поиска путей

## [0.0.2] - 2025-06-24

### Changed
- Переход на использование настроек VS Code вместо файла конфигурации hbs-master.config.js
- Добавлены настройки для управления функциональностью расширения

### Added
- Настройка `hbsMaster.partialsPath` для указания пути к партиалам
- Настройка `hbsMaster.enableHoverDocs` для управления показом документации
- Настройка `hbsMaster.enableSignatureHelp` для управления подсказками параметров
- Настройка `hbsMaster.enableParameterHighlight` для управления подсветкой параметров
- Автоматическая очистка кеша при изменении настроек

### Improved
- Улучшена производительность за счет кеширования документации
- Добавлена обработка изменений конфигурации в реальном времени

## [0.0.1] - 2025-06-24

### Added
- Базовая навигация по партиалам Handlebars
- Поддержка Go to Definition (F12, Ctrl+Click)
- Показ документации при наведении курсора
- Автодополнение параметров компонентов
- Подсказки параметров (Signature Help)
- Подсветка параметров в коде
- Поддержка HBSDoc комментариев в .hbs файлах
