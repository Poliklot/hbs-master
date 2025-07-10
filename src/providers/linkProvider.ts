import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { partialsDir } from '../utils/paths';

export function register(ctx: vscode.ExtensionContext) {
  const re = /{{>\s*['"]([^'"]+)['"]/g;

  const provider = vscode.languages.registerDocumentLinkProvider('handlebars', {
    provideDocumentLinks(doc) {
      const links: vscode.DocumentLink[] = [];
      const text = doc.getText();
      let m: RegExpExecArray | null;

      while ((m = re.exec(text))) {
        const full = m[1];
        const start = doc.positionAt(m.index + m[0].indexOf(full));
        const end   = start.translate(0, full.length);

        const file = path.join(partialsDir(), `${full}.hbs`);
        if (fs.existsSync(file)) {
          links.push(
            new vscode.DocumentLink(new vscode.Range(start, end), vscode.Uri.file(file))
          );
        }
      }
      return links;
    },
  });

  ctx.subscriptions.push(provider);
}
