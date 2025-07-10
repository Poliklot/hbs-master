import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { partialsDir } from '../utils/paths';
import { log } from '../utils/logger';

// ⇠ NEW:
import { getDoc } from '../utils/docs';
import { HbsDocParser } from '../hbs-doc-parser';

/* -------------------------------------------------------------- */
/*                        FILE + PARAM COMPLETION                 */
/* -------------------------------------------------------------- */

function getFileCompletions(
  rawPath: string,
  position: vscode.Position,
  document: vscode.TextDocument
): vscode.CompletionItem[] {
  /* ────────── вычисляем директорию поиска, как было ────────── */
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

  /* ----------------------------------------------------------- */
  /* ➊  FILE/FOLDER completion (ваша старая логика)              */
  /* ----------------------------------------------------------- */

  const fileItems = fs.readdirSync(searchDir)
    .filter(name =>
      !name.startsWith('.') &&
      (filter === '' || name.toLowerCase().startsWith(filter.toLowerCase())) &&
      (fs.statSync(path.join(searchDir, name)).isDirectory() || name.endsWith('.hbs')) // ← .hbs only
    )
    .map(name => {
      const full  = path.join(searchDir, name);
      const isDir = fs.statSync(full).isDirectory();

      const item = new vscode.CompletionItem(
        name,
        isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File
      );

      item.insertText = isDir ? `${name}/` : name.replace(/\.hbs$/, '');

      /* удаляем лишний '/' в начале */
      if (hasLeadingSlash) {
        const quoteStart = position.character - rawPath.length - 1;
        const slashPos   = quoteStart + 1;
        item.additionalTextEdits = [
          vscode.TextEdit.delete(new vscode.Range(position.line, slashPos, position.line, slashPos + 1))
        ];
      }

      if (isDir) {
        item.command = { command: 'editor.action.triggerSuggest', title: '' };
      }
      return item;
    });

  /* ----------------------------------------------------------- */
  /* ➋  PARAMETER completion из HBSDoc (Новый пункт 3)           */
  /* ----------------------------------------------------------- */

  // пытаемся найти *.hbs файл, представляющий сам компонент этой папки
  const hbsFile = fs.readdirSync(searchDir).find(f => f.endsWith('.hbs'));
  const paramItems: vscode.CompletionItem[] = [];

  if (hbsFile) {
    // относительный путь от partialsDir без расширения
    const compPath = path
      .relative(partialsDir(), path.join(searchDir, hbsFile))
      .replace(/\.hbs$/, '')
      .replace(/\\/g, '/');

    const docInfo = getDoc(compPath);
    if (docInfo) {
      paramItems.push(
        ...HbsDocParser.createCompletionItems(docInfo).map(ci => {
          // чтобы свойство заменяло текущий ввод (и убирало `/`-префикс, если был)
          ci.range = new vscode.Range(
            position.line,
            position.character - filter.length - (hasLeadingSlash ? 1 : 0),
            position.line,
            position.character
          );
          return ci;
        })
      );
    }
  }

  /* ----------------------------------------------------------- */
  /* ➌  Объединяем и возвращаем                                  */
  /* ----------------------------------------------------------- */
  return [...paramItems, ...fileItems];
}

/* -------------------------------------------------------------- */
/*                       ʀᴇɢɪsᴛʀᴀᴛɪᴏɴ                          */
/* -------------------------------------------------------------- */

export function register(ctx: vscode.ExtensionContext) {
  let insidePartial = false;

  const mainProvider = vscode.languages.registerCompletionItemProvider(
    'handlebars',
    {
      provideCompletionItems(document, position) {
        const linePrefix = document.lineAt(position).text.slice(0, position.character);
        const m = linePrefix.match(/\{\{\>\s*['"]([^'"]*?)$/);
        if (!m) { insidePartial = false; return; }

        const quotePos  = linePrefix.lastIndexOf(m[1]) - 1;
        const quoteChar = linePrefix[quotePos];
        const suffix    = document.lineAt(position).text.slice(position.character);

        if (!suffix.startsWith(quoteChar)) { insidePartial = false; return; }

        insidePartial = true;
        return getFileCompletions(m[1], position, document);
      }
    },
    "'", '"', '/', '-', '_', '.', ...'abcdefghijklmnopqrstuvwxyz', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'0123456789'
  );

  const filterProvider = vscode.languages.registerCompletionItemProvider(
    'handlebars',
    { provideCompletionItems: () => (insidePartial ? [] : undefined) },
    "'", '"', '/'
  );

  /* авто-suggest при навигации курсором */
  const cursorChange = vscode.window.onDidChangeTextEditorSelection(e => {
    if (!e.selections.length) return;

    const doc = e.textEditor.document;
    const pos = e.selections[0].active;

    const prev = doc.getText(new vscode.Range(pos.translate(0, -1), pos));
    const next = doc.getText(new vscode.Range(pos, pos.translate(0, 1)));

    if ((prev === "'" && next === "'") || (prev === '"' && next === '"')) {
      const prefix = doc.getText(new vscode.Range(new vscode.Position(pos.line, 0), pos.translate(0, -1))).trimEnd();
      if (prefix.endsWith('{{>')) {
        insidePartial = true;
        setTimeout(() => vscode.commands.executeCommand('editor.action.triggerSuggest'), 50);
      }
    }
  });

  ctx.subscriptions.push(mainProvider, filterProvider, cursorChange);
}
