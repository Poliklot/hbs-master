import * as vscode from 'vscode';
import { getConfig }   from '../utils/config';
import { getDoc }      from '../utils/docs';
import { HbsDocParser } from '../hbs-doc-parser';

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      'handlebars',
      {
        provideSignatureHelp(doc, pos) {
          if (!getConfig().get('enableSignatureHelp', true)) return;

          const comp = HbsDocParser.getComponentNameAtPosition(doc, pos);
          if (!comp) return;

          const info = getDoc(comp);
          if (!info) return;

          const sigHelp = new vscode.SignatureHelp();
          const sig = new vscode.SignatureInformation(
            info.name || comp,
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
          const cur = HbsDocParser.getCurrentParameter(doc, pos);
          sigHelp.activeParameter = cur
            ? info.properties.findIndex(p => p.name === cur)
            : 0;

          sigHelp.signatures      = [sig];
          sigHelp.activeSignature = 0;
          return sigHelp;
        }
      },
      ' ', '='
    )
  );
}
