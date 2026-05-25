import * as vscode from 'vscode';
import * as fs from 'fs';
import { partialFilePath } from '../utils/paths';
import { findPartialInvocations } from '../utils/partials';

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerDocumentLinkProvider('handlebars', {
    provideDocumentLinks(doc) {
      const links: vscode.DocumentLink[] = [];

      for (const invocation of findPartialInvocations(doc)) {
        if (!invocation.component || !invocation.componentRange) continue;

        const file = partialFilePath(invocation.component, doc);
        if (file && fs.existsSync(file)) {
          links.push(new vscode.DocumentLink(invocation.componentRange, vscode.Uri.file(file)));
        }
      }

      return links;
    },
  });

  ctx.subscriptions.push(provider);
}
