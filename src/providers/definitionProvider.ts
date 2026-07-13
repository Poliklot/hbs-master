import * as vscode from 'vscode';
import * as fs from 'fs';
import { partialFilePath } from '../utils/paths';
import { getPartialInvocationAtPosition, getVisibleInlinePartialDefinition } from '../utils/partials';

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerDefinitionProvider('handlebars', {
    provideDefinition(doc, pos) {
      const invocation = getPartialInvocationAtPosition(doc, pos);
      if (!invocation?.component || !invocation.componentRange?.contains(pos)) return undefined;

      const inlineDefinition = getVisibleInlinePartialDefinition(doc, invocation.component, pos);
      if (inlineDefinition) {
        return new vscode.Location(doc.uri, inlineDefinition.nameRange.start);
      }

      const file = partialFilePath(invocation.component, doc);
      if (!file || !fs.existsSync(file)) return undefined;

      return new vscode.Location(vscode.Uri.file(file), new vscode.Position(0, 0));
    }
  });

  ctx.subscriptions.push(provider);
}
