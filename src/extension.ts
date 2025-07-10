import * as vscode from 'vscode';
import { channel } from './utils/logger';
import { watchDocs } from './utils/docs';

// провайдеры
import * as def from './providers/definitionProvider';
import * as link from './providers/linkProvider';
import * as hover from './providers/hoverProvider';
import * as comp from './providers/completionProvider';
import * as sig from './providers/signatureHelpProvider';
import * as high from './providers/highlightProvider';

export function activate(ctx: vscode.ExtensionContext) {
  channel.appendLine('HBS Master activated!');

  watchDocs(ctx);
  def.register(ctx);
  link.register(ctx);
  hover.register(ctx);
  comp.register(ctx);
  sig.register(ctx);
  high.register(ctx);
}

export function deactivate() {}
