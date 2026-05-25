import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getDoc }    from '../utils/docs';
import { findPartialInvocations, getHashPairAtPosition, getHashPairs, getPartialInvocationAtPosition } from '../utils/partials';

export function register(ctx: vscode.ExtensionContext) {
  const provider = vscode.languages.registerDocumentHighlightProvider('handlebars', {
    provideDocumentHighlights(doc, pos) {
      if (!getConfig().get('enableParameterHighlight', true)) return [];

      const invocation = getPartialInvocationAtPosition(doc, pos);
      const pair = getHashPairAtPosition(doc, pos, invocation);
      if (!invocation?.component || !pair) return [];

      const info = getDoc(invocation.component, doc);
      if (!info || !info.properties.some(p => p.name === pair.name)) return [];

      const highlights: vscode.DocumentHighlight[] = [];

      for (const currentInvocation of findPartialInvocations(doc)) {
        if (currentInvocation.component !== invocation.component) continue;

        for (const currentPair of getHashPairs(doc, currentInvocation)) {
          if (currentPair.name === pair.name) {
            highlights.push(new vscode.DocumentHighlight(currentPair.nameRange));
          }
        }
      }

      return highlights;
    },
  });

  ctx.subscriptions.push(provider);
}
