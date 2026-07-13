import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { getDoc } from '../utils/docs';
import { getHashPairAtPosition, getPartialInvocationAtPosition } from '../utils/partials';

function displayType(type: string): string {
  const trimmed = type.trim();
  if (trimmed.startsWith('{') || trimmed.includes('\n')) {
    return trimmed.endsWith('[]') ? 'Object[]' : 'Object';
  }
  return trimmed.replace(/\s+/g, ' ');
}

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.languages.registerSignatureHelpProvider(
      'handlebars',
      {
        provideSignatureHelp(document, position) {
          if (!getConfig(document).get('enableSignatureHelp', true)) return;

          const invocation = getPartialInvocationAtPosition(document, position);
          if (!invocation?.component) return;

          const info = getDoc(invocation.component, document);
          if (!info) return;

          const componentName = info.name || invocation.component;
          let label = `${componentName}(`;
          const labels: Array<[number, number]> = [];

          info.properties.forEach((property, index) => {
            if (index) label += ', ';
            const start = label.length;
            label += `${property.name}${property.optional ? '?' : ''}: ${displayType(property.type)}`;
            labels.push([start, label.length]);
          });
          label += ')';

          const signature = new vscode.SignatureInformation(label, info.description);
          signature.parameters = info.properties.map((property, index) => {
            const markdown = new vscode.MarkdownString();
            markdown.appendMarkdown(`**${property.name}${property.optional ? '?' : ''}**: \`${displayType(property.type)}\``);
            markdown.appendMarkdown(`\n\n${property.optional ? 'Optional' : 'Required'}.`);
            if (property.description) markdown.appendMarkdown(`\n\n${property.description}`);
            if (property.defaultValue !== undefined) {
              markdown.appendMarkdown(`\n\n*Default:* \`${property.defaultValue}\``);
            }

            const aliases = info.types.filter(alias => {
              const escapedName = alias.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return new RegExp(`(^|[^\\w$])${escapedName}($|[^\\w$])`).test(property.type);
            });
            aliases.forEach(alias => markdown.appendCodeblock(`${alias.name}: ${alias.body}`, 'ts'));

            return new vscode.ParameterInformation(labels[index], markdown);
          });

          const pair = getHashPairAtPosition(document, position, invocation);
          const index = pair
            ? info.properties.findIndex(property => property.name === pair.name)
            : 0;
          const activeParameter = index >= 0 ? index : 0;

          signature.activeParameter = activeParameter;
          const signatureHelp = new vscode.SignatureHelp();
          signatureHelp.signatures = [signature];
          signatureHelp.activeSignature = 0;
          signatureHelp.activeParameter = activeParameter;
          return signatureHelp;
        },
      },
      ' ', '=', ','
    )
  );
}
