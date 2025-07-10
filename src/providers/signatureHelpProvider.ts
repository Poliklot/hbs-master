import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getDoc }    from '../utils/docs';
import { HbsDocParser } from '../hbs-doc-parser';

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerSignatureHelpProvider(
    'handlebars',
    {
      provideSignatureHelp(doc, pos) {
        if (!getConfig().get('enableSignatureHelp', true)) return;

        const component = HbsDocParser.getComponentNameAtPosition(doc, pos);
        if (!component) return;

        const info = getDoc(component);
        if (!info) return;

        const sigHelp = new vscode.SignatureHelp();
        const sig = new vscode.SignatureInformation(
          info.name || component,
          info.description,
        );

        sig.parameters = info.properties.map(p => {
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`**${p.name}${p.optional ? '?' : ''}**: \`${p.type}\``);
          if (p.description)  md.appendMarkdown(` — ${p.description}`);
          if (p.defaultValue) md.appendMarkdown(`\n\n*По умолчанию:* \`${p.defaultValue}\``);

          return new vscode.ParameterInformation(
            `${p.name}${p.optional ? '?' : ''}: ${p.type}`,
            md,
          );
        });

        sigHelp.signatures       = [sig];
        sigHelp.activeSignature  = 0;

        const cur = HbsDocParser.getCurrentParameter(doc, pos);
        if (cur) sigHelp.activeParameter = info.properties.findIndex(p => p.name === cur);

        return sigHelp;
      },
    },
    ' ', '=',               // trigger characters
  );

  ctx.subscriptions.push(provider);
}
