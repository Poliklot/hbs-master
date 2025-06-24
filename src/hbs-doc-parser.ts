import * as vscode from 'vscode';

export interface HbsDocProperty {
  name: string;
  type: string;
  description: string;
  optional: boolean;
  defaultValue?: string;
}

export interface HbsDocInfo {
  name?: string;
  description?: string;
  properties: HbsDocProperty[];
}

export class HbsDocParser {
  /**
   * Парсит hbs-doc комментарий из текста файла
   */
  public static parseHbsDoc(text: string): HbsDocInfo | null {
    const docRegex = /{{!--\s*([\s\S]*?)\s*--}}/;
    const match = text.match(docRegex);
    
    if (!match) {
      return null;
    }

    const docContent = match[1];
    const info: HbsDocInfo = {
      properties: []
    };

    const lines = docContent.split('\n').map(line => line.trim());
    
    let pendingDescription: string | null = null;
    let pendingDefault: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Парсинг @name для компонента
      if (line.startsWith('@name ')) {
        info.name = line.substring(6).trim();
        continue;
      }

      // Парсинг @description
      if (line.startsWith('@description ')) {
        const description = line.substring(13).trim();
        
        // Проверяем, есть ли следующая строка со свойством
        const nextLine = i + 1 < lines.length ? lines[i + 1] : null;
        const nextNextLine = i + 2 < lines.length ? lines[i + 2] : null;
        
        // Если следующая строка - @default, то описание относится к свойству после @default
        if (nextLine && nextLine.startsWith('@default ')) {
          pendingDescription = description;
          continue;
        }
        
        // Если следующая строка - свойство, то описание относится к нему
        if (nextLine && nextLine.match(/^(\w+)(\?)?:\s*(.+);?$/)) {
          pendingDescription = description;
          continue;
        }
        
        // Если через строку после @default есть свойство
        if (nextLine && nextLine.startsWith('@default ') && 
            nextNextLine && nextNextLine.match(/^(\w+)(\?)?:\s*(.+);?$/)) {
          pendingDescription = description;
          continue;
        }
        
        // Иначе это описание компонента
        info.description = description;
        continue;
      }

      // Парсинг @default
      if (line.startsWith('@default ')) {
        pendingDefault = line.substring(9).trim().replace(/^"(.*)"$/, '$1');
        continue;
      }

      // Парсинг свойства (name: type или name?: type)
      const propertyMatch = line.match(/^(\w+)(\?)?:\s*(.+);?$/);
      if (propertyMatch) {
        const property: HbsDocProperty = {
          name: propertyMatch[1],
          optional: !!propertyMatch[2],
          type: propertyMatch[3].replace(/;$/, ''),
          description: pendingDescription || '',
          defaultValue: pendingDefault || undefined
        };

        info.properties.push(property);
        
        // Сбрасываем pending значения
        pendingDescription = null;
        pendingDefault = null;
        continue;
      }

      // Если строка не пустая и нет pending описания,
      // возможно это продолжение описания компонента
      if (line && !pendingDescription && info.description) {
        info.description += ' ' + line;
      }
    }

    return info;
  }

  /**
   * Создает hover информацию для компонента
   */
  public static createHoverInfo(docInfo: HbsDocInfo): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    if (docInfo.name) {
      markdown.appendMarkdown(`### ${docInfo.name}\n\n`);
    }

    if (docInfo.description) {
      markdown.appendMarkdown(`${docInfo.description}\n\n`);
    }

    if (docInfo.properties.length > 0) {
      markdown.appendMarkdown('**Свойства:**\n\n');
      
      for (const prop of docInfo.properties) {
        const optional = prop.optional ? '?' : '';
        markdown.appendMarkdown(`- **${prop.name}${optional}**: \`${prop.type}\``);
        
        if (prop.description) {
          markdown.appendMarkdown(` - ${prop.description}`);
        }

        if (prop.defaultValue) {
          markdown.appendMarkdown(` *(по умолчанию: \`${prop.defaultValue}\`)*`);
        }
        
        markdown.appendMarkdown('\n');
      }
    }

    return markdown;
  }

  /**
   * Создает completion items для свойств компонента
   */
  public static createCompletionItems(docInfo: HbsDocInfo): vscode.CompletionItem[] {
    const items: vscode.CompletionItem[] = [];

    for (const prop of docInfo.properties) {
      const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
      
      // Создаем snippet для свойства
      const snippet = prop.type.includes('boolean') 
        ? `${prop.name}=\${1|true,false|}`
        : `${prop.name}="\${1:${prop.type}}"`;
      
      item.insertText = new vscode.SnippetString(snippet);
      
      // Документация для свойства
      const documentation = new vscode.MarkdownString();
      documentation.appendMarkdown(`**${prop.name}${prop.optional ? '?' : ''}**: \`${prop.type}\`\n\n`);
      if (prop.description) {
        documentation.appendMarkdown(prop.description);
      }
      if (prop.defaultValue) {
        documentation.appendMarkdown(`\n\n*По умолчанию:* \`${prop.defaultValue}\``);
      }
      item.documentation = documentation;

      items.push(item);
    }

    return items;
  }

  /**
   * Проверяет, является ли позиция внутри тега компонента
   */
  public static isInsideComponentTag(document: vscode.TextDocument, position: vscode.Position): boolean {
    const line = document.lineAt(position.line).text;
    const beforeCursor = line.substring(0, position.character);
    const afterCursor = line.substring(position.character);

    // Проверяем, что мы внутри {{> ... }}
    const openIndex = beforeCursor.lastIndexOf('{{>');
    const closeIndex = afterCursor.indexOf('}}');

    return openIndex !== -1 && closeIndex !== -1;
  }

  /**
   * Получает имя компонента из текущей позиции
   */
  public static getComponentNameAtPosition(document: vscode.TextDocument, position: vscode.Position): string | null {
    // Поиск по нескольким строкам для многострочных компонентов
    let searchStartLine = Math.max(0, position.line - 10);
    let searchEndLine = Math.min(document.lineCount - 1, position.line + 10);
    
    let fullText = '';
    for (let i = searchStartLine; i <= searchEndLine; i++) {
      fullText += document.lineAt(i).text + '\n';
    }

    // Ищем все компоненты в тексте
    const componentRegex = /{{>\s*'([^']+)'[\s\S]*?}}/g;
    let match: RegExpExecArray | null;
    
    while ((match = componentRegex.exec(fullText))) {
      const startIndex = match.index;
      const endIndex = match.index + match[0].length;
      
      // Преобразуем индексы обратно в позиции документа
      const startPos = this.indexToPosition(fullText, startIndex, searchStartLine);
      const endPos = this.indexToPosition(fullText, endIndex, searchStartLine);
      
      if (startPos && endPos && 
          position.line >= startPos.line && position.line <= endPos.line) {
        
        // Проверяем, что позиция действительно внутри этого компонента
        if (position.line === startPos.line && position.character < startPos.character) continue;
        if (position.line === endPos.line && position.character > endPos.character) continue;
        
        return match[1];
      }
    }
    
    return null;
  }

  /**
   * Получает текущий параметр под курсором
   */
  public static getCurrentParameter(document: vscode.TextDocument, position: vscode.Position): string | null {
    const line = document.lineAt(position.line).text;
    const beforeCursor = line.substring(0, position.character);
    
    // Ищем последний параметр перед курсором
    const paramMatch = beforeCursor.match(/(\w+)=("[^"]*"?|[^\s}]*)$/);
    if (paramMatch) {
      return paramMatch[1];
    }
    
    return null;
  }

  private static indexToPosition(text: string, index: number, startLine: number): vscode.Position | null {
    const lines = text.substring(0, index).split('\n');
    const line = startLine + lines.length - 1;
    const character = lines[lines.length - 1].length;
    return new vscode.Position(line, character);
  }
}