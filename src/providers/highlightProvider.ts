import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getDoc }    from '../utils/docs';
import { HbsDocParser } from '../hbs-doc-parser';

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerDocumentHighlightProvider('handlebars', {
    provideDocumentHighlights(doc, pos) {
      if (!getConfig().get('enableParameterHighlight', true)) return [];

      const param = HbsDocParser.getCurrentParameter(doc, pos);
      const comp  = HbsDocParser.getComponentNameAtPosition(doc, pos);
      if (!param || !comp) return [];

      const info = getDoc(comp);
      if (!info || !info.properties.some(p => p.name === param)) return [];

      const regex = new RegExp(`\\b${param}=`, 'g');
      const text  = doc.getText();
      const highlights: vscode.DocumentHighlight[] = [];

      let m: RegExpExecArray | null;
      while ((m = regex.exec(text))) {
        const start = doc.positionAt(m.index);
        const end   = start.translate(0, param.length);
        highlights.push(new vscode.DocumentHighlight(new vscode.Range(start, end)));
      }
      return highlights;
    },
  });

  ctx.subscriptions.push(provider);
}
