import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig }  from '../utils/config';
import { getDoc }     from '../utils/docs';
import { HbsDocParser } from '../hbs-doc-parser';
import { getHashPairAtPosition, getHashPairs, getPartialInvocationAtPosition } from '../utils/partials';
import { normalizePartialPath, partialFilePath, partialsDir } from '../utils/paths';

function sourceLabel(componentPath: string, doc: vscode.TextDocument): string | undefined {
  const sourceFile = partialFilePath(componentPath, doc);
  if (!sourceFile) return undefined;

  const relativeToPartials = path.relative(partialsDir(doc), sourceFile).replace(/\\/g, '/');
  if (relativeToPartials && !relativeToPartials.startsWith('..') && !path.isAbsolute(relativeToPartials)) {
    return relativeToPartials;
  }

  const normalized = normalizePartialPath(componentPath);
  return normalized ? `${normalized}.hbs` : sourceFile;
}

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.languages.registerHoverProvider('handlebars', {
      provideHover(doc, pos) {
        if (!getConfig().get('enableHoverDocs', true)) return;

        const invocation = getPartialInvocationAtPosition(doc, pos);
        if (!invocation?.component) return;

        const info = getDoc(invocation.component, doc);
        if (!info) return;

        const pairs = getHashPairs(doc, invocation);
        const usedParameterNames = pairs.map(pair => pair.name);
        const missingRequired = info.properties
          .filter(property => !property.optional && !usedParameterNames.includes(property.name))
          .map(property => property.name);
        const hoverOptions = {
          componentPath: invocation.component,
          source: sourceLabel(invocation.component, doc),
          missingRequired,
          usedParameters: usedParameterNames,
        };

        // ► курсор на параметре → показываем только его
        const pair = getHashPairAtPosition(doc, pos, invocation);
        if (pair) {
          const property = info.properties.find(x => x.name === pair.name);
          return new vscode.Hover(
            property
              ? HbsDocParser.createParameterHoverInfo(info, property, hoverOptions)
              : HbsDocParser.createUnknownParameterHoverInfo(pair.name, info, hoverOptions)
          );
        }

        // ► курсор на имени partial → полная документация компонента
        if (invocation.componentRange?.contains(pos)) {
          return new vscode.Hover(HbsDocParser.createHoverInfo(info, hoverOptions));
        }

        // ► внутри вызова, но не на конкретном аргументе → короткая сводка
        return new vscode.Hover(HbsDocParser.createInvocationSummaryHoverInfo(info, hoverOptions));
      }
    })
  );
}
