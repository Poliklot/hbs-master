import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getDoc }   from '../utils/docs';
import { HbsDocParser } from '../hbs-doc-parser';

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerHoverProvider('handlebars', {
    provideHover(doc, pos) {
      if (!getConfig().get('enableHoverDocs', true)) return;

      // имя компонента и (если есть) текущий параметр
      const component = HbsDocParser.getComponentNameAtPosition(doc, pos);
      if (!component) return;

      const info = getDoc(component);
      if (!info) return;

      const paramName = HbsDocParser.getCurrentParameter(doc, pos);

      // ► Hover над ВСЕМ компонентом
      if (!paramName) {
        return new vscode.Hover(HbsDocParser.createHoverInfo(info));
      }

      // ► Hover над конкретным параметром
      const param = info.properties.find(p => p.name === paramName);
      if (!param) return;

      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${param.name}${param.optional ? '?' : ''}**: \`${param.type}\``);
      if (param.description) md.appendMarkdown(` — ${param.description}`);
      if (param.defaultValue) md.appendMarkdown(`\n\n*По умолчанию:* \`${param.defaultValue}\``);

      return new vscode.Hover(md);
    },
  });

  ctx.subscriptions.push(provider);
}
