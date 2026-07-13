import * as vscode from 'vscode';
import * as fs from 'fs';
import { partialFilePath } from '../utils/paths';
import { findPartialInvocations } from '../utils/partials';

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerDocumentLinkProvider('handlebars', {
    provideDocumentLinks(doc) {
      const links: vscode.DocumentLink[] = [];
      const resolvedFiles = new Map<string, string | null>();

      for (const invocation of findPartialInvocations(doc)) {
        if (!invocation.component || !invocation.componentRange) continue;

        let file = resolvedFiles.get(invocation.component);
        if (file === undefined) {
          file = partialFilePath(invocation.component, doc);
          resolvedFiles.set(invocation.component, file);
        }
        if (file && fs.existsSync(file)) {
          links.push(new vscode.DocumentLink(invocation.componentRange, vscode.Uri.file(file)));
        }
      }

      return links;
    },
  });

  ctx.subscriptions.push(provider);
}
