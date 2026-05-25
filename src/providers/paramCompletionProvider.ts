import * as vscode from 'vscode';
import { HbsDocParser } from '../hbs-doc-parser';
import { getDoc }       from '../utils/docs';
import { getHashPairs, getPartialInvocationAtPosition } from '../utils/partials';

export function register(ctx: vscode.ExtensionContext) {
  /**
   * Символ-триггеры: буквы, цифры, -, _
   * (VS Code будет звать провайдер при каждом вводе символа).
   */
  const TRIGGERS = [
    ...'abcdefghijklmnopqrstuvwxyz',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ...'0123456789',
    '-', '_'
  ];

  const provider = vscode.languages.registerCompletionItemProvider(
    'handlebars',
    {
      provideCompletionItems(doc, pos) {
        /* ① Проверяем: курсор внутри {{> 'component' … }}  */
        const invocation = getPartialInvocationAtPosition(doc, pos);
        if (!invocation?.component) return;

        /* ② Смотрим, не находимся ли мы всё ещё в строке пути */
        if (invocation.componentRange?.contains(pos)) return;           // всё ещё печатаем путь

        const info = getDoc(invocation.component, doc);
        if (!info) return;

        const before = doc.lineAt(pos.line).text.slice(0, pos.character);
        const paramMatch = before.match(/([\w-]*)$/);
        const prefix = paramMatch ? paramMatch[1] : '';
        const used = new Set(getHashPairs(doc, invocation).map(pair => pair.name));

        return HbsDocParser.createCompletionItems(info)
          .filter(item => !used.has(item.label.toString()))
          .filter(item => item.label.toString().startsWith(prefix))
          .map(item => {
            item.range = new vscode.Range(
              pos.line,
              pos.character - prefix.length,
              pos.line,
              pos.character
            );
            return item;
          });
      }
    },
    ...TRIGGERS
  );

  ctx.subscriptions.push(provider);
}
