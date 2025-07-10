import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { partialsDir } from '../utils/paths';

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerDefinitionProvider('handlebars', {
    provideDefinition(doc, pos) {
      const line = doc.lineAt(pos.line).text;
      const re = /{{>\s*'([^']+)'/g;
      let m: RegExpExecArray | null;

      while ((m = re.exec(line))) {
        const full = m[1];
        const quoteStart = m.index + m[0].indexOf("'") + 1;
        const quoteEnd = quoteStart + full.length;
        const range = new vscode.Range(pos.line, quoteStart, pos.line, quoteEnd);

        if (range.contains(pos)) {
          const file = path.join(partialsDir(), `${full}.hbs`);
          if (!fs.existsSync(file)) return;
          return new vscode.Location(vscode.Uri.file(file), new vscode.Position(0, 0));
        }
      }
    }
  });

  ctx.subscriptions.push(provider);
}
