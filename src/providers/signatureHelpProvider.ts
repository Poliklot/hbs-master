import * as vscode from 'vscode';
import { getConfig }   from '../utils/config';
import { getDoc }      from '../utils/docs';
import { getHashPairAtPosition, getPartialInvocationAtPosition } from '../utils/partials';

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      'handlebars',
      {
        provideSignatureHelp(doc, pos) {
          if (!getConfig(doc).get('enableSignatureHelp', true)) return;

          const invocation = getPartialInvocationAtPosition(doc, pos);
          if (!invocation?.component) return;

          const info = getDoc(invocation.component, doc);
          if (!info) return;

          const sigHelp = new vscode.SignatureHelp();
          const sig = new vscode.SignatureInformation(
            info.name || invocation.component,
            info.description
          );

          sig.parameters = info.properties.map(p => {
            const md = new vscode.MarkdownString();
            md.appendMarkdown(`**${p.name}${p.optional ? '?' : ''}**: \`${p.type}\``);
            if (p.description)  md.appendMarkdown(` — ${p.description}`);
            if (p.defaultValue) md.appendMarkdown(`\n\n*По умолчанию:* \`${p.defaultValue}\``);
            return new vscode.ParameterInformation(`${p.name}: ${p.type}`, md);
          });

          // определяем активный параметр по названию
          const pair = getHashPairAtPosition(doc, pos, invocation);
          const index = pair
            ? info.properties.findIndex(p => p.name === pair.name)
            : 0;
          sigHelp.activeParameter = index >= 0 ? index : 0;

          sigHelp.signatures      = [sig];
          sigHelp.activeSignature = 0;
          return sigHelp;
        }
      },
      ' ', '='
    )
  );
}
