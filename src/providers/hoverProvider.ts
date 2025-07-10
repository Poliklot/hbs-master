import * as vscode from 'vscode';
import { getConfig }  from '../utils/config';
import { getDoc }     from '../utils/docs';
import { HbsDocParser } from '../hbs-doc-parser';

export function register(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.languages.registerHoverProvider('handlebars', {
      provideHover(doc, pos) {
        if (!getConfig().get('enableHoverDocs', true)) return;

        const comp = HbsDocParser.getComponentNameAtPosition(doc, pos);
        if (!comp) return;

        const info = getDoc(comp);
        if (!info) return;

        // ► курсор на параметре → показываем только его
        const param = HbsDocParser.getCurrentParameter(doc, pos);
        if (param) {
          const p = info.properties.find(x => x.name === param);
          if (!p) return;
          return new vscode.Hover(HbsDocParser.createHoverInfo({ ...info, properties: [p] }));
        }

        // ► иначе – весь компонент
        return new vscode.Hover(HbsDocParser.createHoverInfo(info));
      }
    })
  );
}
