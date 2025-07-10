import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { partialsDir } from '../utils/paths';
import { log } from '../utils/logger';

function getFileCompletions(rawPath: string, position: vscode.Position, document: vscode.TextDocument): vscode.CompletionItem[] {
    // Убираем ./ и ведущие /, но сохраняем информацию о начальном слеше
    const hasLeadingSlash = rawPath.startsWith('/');
    const current = rawPath.replace(/^\.?\//, '');

    let searchDir: string;
    let filter = '';

    if (current.endsWith('/')) {
        searchDir = path.join(partialsDir(), current.slice(0, -1));
    } else if (current.includes('/')) {
        searchDir = path.join(partialsDir(), path.dirname(current));
        filter = path.basename(current);
    } else {
        searchDir = partialsDir();
        filter = current;
    }

    if (!fs.existsSync(searchDir)) return [];

    const items = fs.readdirSync(searchDir)
        .filter(name => !name.startsWith('.') && 
               (filter === '' || name.toLowerCase().startsWith(filter.toLowerCase())))
        .map(name => {
            const full = path.join(searchDir, name);
            const isDir = fs.statSync(full).isDirectory();
            const item = new vscode.CompletionItem(
                name,
                isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
            );

            item.insertText = isDir ? `${name}/` : name.replace(/\.hbs$/, '');
            
            // Удаляем только начальный слеш, если он был
            if (hasLeadingSlash) {
                const quoteStart = position.character - rawPath.length - 1;
                const slashPos = quoteStart + 1;
                
                item.additionalTextEdits = [
                    vscode.TextEdit.delete(
                        new vscode.Range(
                            position.line, slashPos,
                            position.line, slashPos + 1
                        )
                    )
                ];
            }

            if (isDir) {
                item.command = { 
                    command: 'editor.action.triggerSuggest', 
                    title: 'Re-trigger suggestions' 
                };
            }

            return item;
        });

    return items;
}

export function register(ctx: vscode.ExtensionContext) {
    let isInsideHandlebarPartial = false;

    // Основной провайдер автодополнения
    const mainProvider = vscode.languages.registerCompletionItemProvider(
        'handlebars',
        {
            provideCompletionItems(document, position) {
                const linePrefix = document.lineAt(position).text.slice(0, position.character);
                const m = linePrefix.match(/\{\{\>\s*['"]([^'"]*?)$/);
                if (!m) {
                    isInsideHandlebarPartial = false;
                    return undefined;
                }

                const quotePos = linePrefix.lastIndexOf(m[1]) - 1;
                const quoteChar = linePrefix[quotePos];
                const lineSuffix = document.lineAt(position).text.slice(position.character);
                
                if (!lineSuffix.startsWith(quoteChar)) {
                    isInsideHandlebarPartial = false;
                    return undefined;
                }

                isInsideHandlebarPartial = true;
                return getFileCompletions(m[1], position, document);
            }
        },
        "'", '"', '/'
    );

    // Фильтрующий провайдер для блокировки стандартных подсказок
    const filterProvider = vscode.languages.registerCompletionItemProvider(
        'handlebars',
        {
            provideCompletionItems() {
                // Возвращаем пустой массив в нашем контексте, чтобы блокировать стандартные подсказки
                return isInsideHandlebarPartial ? [] : undefined;
            }
        },
        "'", '"', '/'
    );

    // Отслеживание курсора для автоматического вызова подсказок
    const cursorChangeDisposable = vscode.window.onDidChangeTextEditorSelection(async e => {
        if (e.selections.length === 0) return;
        
        const doc = e.textEditor.document;
        const pos = e.selections[0].active;
        
        // Проверяем, находится ли курсор между пустыми кавычками
        if (pos.character > 0) {
            const prevChar = doc.getText(new vscode.Range(pos.translate(0, -1), pos));
            const nextChar = doc.getText(new vscode.Range(pos, pos.translate(0, 1)));
            
            if ((prevChar === "'" && nextChar === "'") || 
                (prevChar === '"' && nextChar === '"')) {
                
                // Проверяем контекст {{> перед кавычками
                const prefixRange = new vscode.Range(
                    new vscode.Position(pos.line, 0),
                    pos.translate(0, -1)
                );
                const prefixText = doc.getText(prefixRange).trimEnd();
                
                if (prefixText.endsWith('{{>')) {
                    isInsideHandlebarPartial = true;
                    setTimeout(() => {
                        vscode.commands.executeCommand('editor.action.triggerSuggest');
                    }, 100);
                }
            }
        }
    });

    ctx.subscriptions.push(mainProvider, filterProvider, cursorChangeDisposable);
}