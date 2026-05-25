# Changelog

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
