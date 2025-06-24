import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HbsDocParser, HbsDocInfo } from './hbs-doc-parser';

export function activate(context: vscode.ExtensionContext) {
  // Кеш для документации компонентов
  const docCache = new Map<string, HbsDocInfo>();

  // Функция для получения конфигурации
  function getConfig() {
    return vscode.workspace.getConfiguration('hbsMaster');
  }

  // Функция для получения пути к партиалам
  function getPartialsPath(): string {
    const config = getConfig();
    return config.get('partialsPath', 'src/partials');
  }

  // Провайдер для Go to Definition
  const definitionProvider = vscode.languages.registerDefinitionProvider('handlebars', {
    provideDefinition(document, position) {
      return getPartialLocation(document, position, getPartialsPath());
    },
  });

  // Провайдер для документных ссылок
  const documentLinkProvider = vscode.languages.registerDocumentLinkProvider('handlebars', {
    provideDocumentLinks(document) {
      const links: vscode.DocumentLink[] = [];
      const text = document.getText();
      const partialRegex = /{{>\s*'([^']+)'/g;
      let match: RegExpExecArray | null;
      const partialsPath = getPartialsPath();

      while ((match = partialRegex.exec(text))) {
        const fullPath = match[1];
        const startPos = document.positionAt(match.index + match[0].indexOf("'") + 1);
        const endPos = document.positionAt(match.index + match[0].indexOf("'") + 1 + fullPath.length);
        const range = new vscode.Range(startPos, endPos);
        
        const filePath = path.join(vscode.workspace.rootPath || '', partialsPath, `${fullPath}.hbs`);
        
        if (fs.existsSync(filePath)) {
          const uri = vscode.Uri.file(filePath);
          links.push(new vscode.DocumentLink(range, uri));
        }
      }
      
      return links;
    }
  });

  // Провайдер для Hover информации
  const hoverProvider = vscode.languages.registerHoverProvider('handlebars', {
    provideHover(document, position) {
      const config = getConfig();
      if (!config.get('enableHoverDocs', true)) {
        return null;
      }

      const line = document.lineAt(position.line).text;
      const partialRegex = /{{>\s*'([^']+)'/g;
      let match: RegExpExecArray | null;
      const partialsPath = getPartialsPath();

      while ((match = partialRegex.exec(line))) {
        const fullPath = match[1];
        const quoteStart = match.index + match[0].indexOf("'") + 1;
        const quoteEnd = quoteStart + fullPath.length;

        const matchRange = new vscode.Range(
          position.line,
          quoteStart,
          position.line,
          quoteEnd
        );

        if (matchRange.contains(position)) {
          const docInfo = getComponentDocumentation(fullPath, partialsPath, docCache);
          if (docInfo) {
            return new vscode.Hover(HbsDocParser.createHoverInfo(docInfo), matchRange);
          }
        }
      }

      // Если курсор на параметре
      const currentParam = HbsDocParser.getCurrentParameter(document, position);
      const componentPath = HbsDocParser.getComponentNameAtPosition(document, position);

      if (currentParam && componentPath) {
        const docInfo = getComponentDocumentation(componentPath, partialsPath, docCache);
        if (!docInfo) return null;

        const param = docInfo.properties.find(p => p.name === currentParam);
        if (param) {
          const markdown = new vscode.MarkdownString();
          markdown.isTrusted = true;

          markdown.appendMarkdown(`**${param.name}${param.optional ? '?' : ''}**: \`${param.type}\``);
          if (param.description) {
            markdown.appendMarkdown(` — ${param.description}`);
          }
          if (param.defaultValue) {
            markdown.appendMarkdown(`\n\n*По умолчанию:* \`${param.defaultValue}\``);
          }

          return new vscode.Hover(markdown);
        }
      }

      return null;
    }
  });

  // Провайдер для автодополнения
  const completionProvider = vscode.languages.registerCompletionItemProvider('handlebars', {
    provideCompletionItems(document, position) {
      // Проверяем, что мы внутри тега компонента
      if (!HbsDocParser.isInsideComponentTag(document, position)) {
        return [];
      }

      // Находим имя компонента
      const componentPath = HbsDocParser.getComponentNameAtPosition(document, position);
      
      if (!componentPath) {
        return [];
      }

      const docInfo = getComponentDocumentation(componentPath, getPartialsPath(), docCache);
      
      if (docInfo) {
        return HbsDocParser.createCompletionItems(docInfo);
      }

      return [];
    }
  }, ' ', '=', '"'); // Триггеры для автодополнения

  // Провайдер для Signature Help (подсказки параметров)
  const signatureHelpProvider = vscode.languages.registerSignatureHelpProvider('handlebars', {
    provideSignatureHelp(document, position) {
      const config = getConfig();
      if (!config.get('enableSignatureHelp', true)) {
        return null;
      }

      const componentPath = HbsDocParser.getComponentNameAtPosition(document, position);
      
      if (!componentPath) {
        return null;
      }

      const docInfo = getComponentDocumentation(componentPath, getPartialsPath(), docCache);
      
      if (!docInfo) {
        return null;
      }

      const signatureHelp = new vscode.SignatureHelp();
      const signature = new vscode.SignatureInformation(
        docInfo.name || componentPath,
        docInfo.description
      );

      // Добавляем параметры
      signature.parameters = docInfo.properties.map(prop => {
        const paramDoc = new vscode.MarkdownString();
        paramDoc.appendMarkdown(`**${prop.name}${prop.optional ? '?' : ''}**: \`${prop.type}\`\n\n`);
        if (prop.description) {
          paramDoc.appendMarkdown(prop.description);
        }
        if (prop.defaultValue) {
          paramDoc.appendMarkdown(`\n\n*По умолчанию:* \`${prop.defaultValue}\``);
        }

        return new vscode.ParameterInformation(
          `${prop.name}${prop.optional ? '?' : ''}: ${prop.type}`,
          paramDoc
        );
      });

      // Определяем активный параметр
      const currentParam = HbsDocParser.getCurrentParameter(document, position);
      if (currentParam) {
        const paramIndex = docInfo.properties.findIndex(p => p.name === currentParam);
        if (paramIndex !== -1) {
          signatureHelp.activeParameter = paramIndex;
        }
      }

      signatureHelp.signatures = [signature];
      signatureHelp.activeSignature = 0;

      return signatureHelp;
    }
  }, ' ', '=');

  // Провайдер для подсветки параметров
  const documentHighlightProvider = vscode.languages.registerDocumentHighlightProvider('handlebars', {
    provideDocumentHighlights(document, position) {
      const config = getConfig();
      if (!config.get('enableParameterHighlight', true)) {
        return [];
      }

      const currentParam = HbsDocParser.getCurrentParameter(document, position);
      const componentPath = HbsDocParser.getComponentNameAtPosition(document, position);
      
      if (!currentParam || !componentPath) {
        return [];
      }

      const docInfo = getComponentDocumentation(componentPath, getPartialsPath(), docCache);
      
      if (!docInfo) {
        return [];
      }

      // Проверяем, что параметр существует в документации
      const paramExists = docInfo.properties.some(p => p.name === currentParam);
      
      if (!paramExists) {
        return [];
      }

      // Находим все вхождения этого параметра в текущем компоненте
      const highlights: vscode.DocumentHighlight[] = [];
      const text = document.getText();
      
      // Упрощенный поиск параметра в компоненте
      const paramRegex = new RegExp(`\\b${currentParam}=`, 'g');
      let match: RegExpExecArray | null;
      
      while ((match = paramRegex.exec(text))) {
        const startPos = document.positionAt(match.index);
        const endPos = document.positionAt(match.index + currentParam.length);
        
        highlights.push(new vscode.DocumentHighlight(
          new vscode.Range(startPos, endPos),
          vscode.DocumentHighlightKind.Read
        ));
      }

      return highlights;
    }
  });

  // Функция для получения локации партиала
  function getPartialLocation(document: vscode.TextDocument, position: vscode.Position, partialsPath: string) {
    const line = document.lineAt(position.line).text;
    const partialRegex = /{{>\s*'([^']+)'/g;
    let match: RegExpExecArray | null;

    while ((match = partialRegex.exec(line))) {
      const fullPath = match[1];
      const quoteStart = match.index + match[0].indexOf("'") + 1;
      const quoteEnd = quoteStart + fullPath.length;

      const matchRange = new vscode.Range(
        position.line,
        quoteStart,
        position.line,
        quoteEnd
      );

      if (matchRange.contains(position)) {
        const filePath = path.join(vscode.workspace.rootPath || '', partialsPath, `${fullPath}.hbs`);

        if (!fs.existsSync(filePath)) {
          vscode.window.showErrorMessage(`Файл не найден: ${filePath}`);
          return;
        }

        const uri = vscode.Uri.file(filePath);
        return new vscode.Location(uri, new vscode.Position(0, 0));
      }
    }

    return;
  }

  // Функция для получения документации компонента
  function getComponentDocumentation(componentPath: string, partialsPath: string, cache: Map<string, HbsDocInfo>): HbsDocInfo | null {
    // Проверяем кеш
    if (cache.has(componentPath)) {
      return cache.get(componentPath)!;
    }

    const filePath = path.join(vscode.workspace.rootPath || '', partialsPath, `${componentPath}.hbs`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      const docInfo = HbsDocParser.parseHbsDoc(fileContent);
      
      // Сохраняем в кеш
      if (docInfo) {
        cache.set(componentPath, docInfo);
      }
      
      return docInfo;
    } catch (error) {
      console.error('Ошибка при чтении файла:', error);
      return null;
    }
  }

  // Очистка кеша при изменении файлов
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.hbs');
  fileWatcher.onDidChange(() => {
    docCache.clear();
  });
  fileWatcher.onDidCreate(() => {
    docCache.clear();
  });
  fileWatcher.onDidDelete(() => {
    docCache.clear();
  });

  // Обработчик изменения конфигурации
  const configChangeHandler = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('hbsMaster')) {
      // Очищаем кеш при изменении конфигурации
      docCache.clear();
      
      // Можно показать уведомление о перезагрузке конфигурации
      vscode.window.showInformationMessage('Конфигурация HBS Master обновлена');
    }
  });

  context.subscriptions.push(
    definitionProvider,
    documentLinkProvider,
    hoverProvider,
    completionProvider,
    signatureHelpProvider,
    documentHighlightProvider,
    fileWatcher,
    configChangeHandler
  );
}