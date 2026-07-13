const Module = require('node:module');
const path = require('node:path');

let installed = false;
let originalLoad = null;

const state = {
  workspaceRoot: '',
  config: {},
  registrations: [],
  subscriptions: [],
  selectionListeners: [],
  configListeners: [],
  openDocumentListeners: [],
  changeDocumentListeners: [],
  saveDocumentListeners: [],
  closeDocumentListeners: [],
  watchers: [],
  diagnostics: [],
  textDocuments: [],
  commands: [],
  registeredCommands: [],
  logs: [],
  workspaceTrusted: true,
};

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }

  translate(lineDelta = 0, characterDelta = 0) {
    return new Position(this.line + lineDelta, this.character + characterDelta);
  }

  isBefore(other) {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }

  isAfter(other) {
    return this.line > other.line || (this.line === other.line && this.character > other.character);
  }

  isEqual(other) {
    return this.line === other.line && this.character === other.character;
  }
}

class Range {
  constructor(startLineOrPosition, startCharacterOrPosition, endLine, endCharacter) {
    if (startLineOrPosition instanceof Position && startCharacterOrPosition instanceof Position) {
      this.start = startLineOrPosition;
      this.end = startCharacterOrPosition;
    } else {
      this.start = new Position(startLineOrPosition, startCharacterOrPosition);
      this.end = new Position(endLine, endCharacter);
    }
  }

  contains(position) {
    const afterStart = !position.isBefore(this.start);
    const beforeEnd = !position.isAfter(this.end);
    return afterStart && beforeEnd;
  }
}

class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
    this.path = fsPath;
    this.scheme = 'file';
  }

  static file(fsPath) {
    return new Uri(path.resolve(fsPath));
  }

  toString() {
    return `file://${this.fsPath}`;
  }
}

class MarkdownString {
  constructor(value = '') {
    this.value = value;
    this.isTrusted = false;
  }

  appendMarkdown(value) {
    this.value += value;
    return this;
  }

  appendCodeblock(value, language = '') {
    this.value += `\n\n\`\`\`${language}\n${value}\n\`\`\`\n`;
    return this;
  }

  toString() {
    return this.value;
  }
}

class SnippetString {
  constructor(value = '') {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class TextEdit {
  static delete(range) {
    return { range, newText: '' };
  }
}

class Location {
  constructor(uri, rangeOrPosition) {
    this.uri = uri;
    this.range = rangeOrPosition;
  }
}

class DocumentLink {
  constructor(range, target) {
    this.range = range;
    this.target = target;
  }
}

class Hover {
  constructor(contents) {
    this.contents = contents;
  }
}

class SignatureHelp {
  constructor() {
    this.signatures = [];
    this.activeSignature = 0;
    this.activeParameter = 0;
  }
}

class SignatureInformation {
  constructor(label, documentation) {
    this.label = label;
    this.documentation = documentation;
    this.parameters = [];
  }
}

class ParameterInformation {
  constructor(label, documentation) {
    this.label = label;
    this.documentation = documentation;
  }
}

class DocumentHighlight {
  constructor(range) {
    this.range = range;
  }
}

class Diagnostic {
  constructor(range, message, severity) {
    this.range = range;
    this.message = message;
    this.severity = severity;
  }
}

class WorkspaceEdit {
  constructor() {
    this.operations = [];
  }

  createFile(uri, options) {
    this.operations.push({ type: 'createFile', uri, options });
  }

  insert(uri, position, newText) {
    this.operations.push({ type: 'insert', uri, position, newText });
  }

  delete(uri, range) {
    this.operations.push({ type: 'delete', uri, range });
  }
}

class CodeAction {
  constructor(title, kind) {
    this.title = title;
    this.kind = kind;
    this.diagnostics = [];
    this.isPreferred = false;
  }
}

const CompletionItemKind = {
  Text: 0,
  Method: 1,
  Function: 2,
  Constructor: 3,
  Field: 4,
  Variable: 5,
  Class: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Unit: 10,
  Value: 11,
  Enum: 12,
  Keyword: 13,
  Snippet: 14,
  Color: 15,
  File: 16,
  Reference: 17,
  Folder: 18,
};

const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

const CodeActionKind = {
  QuickFix: { value: 'quickfix' },
};

function disposable(kind, payload) {
  return {
    kind,
    payload,
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
}

function register(kind, language, provider, triggers = []) {
  const entry = { kind, language, provider, triggers };
  state.registrations.push(entry);
  return disposable(kind, entry);
}

function createWatcher(pattern) {
  const listeners = { change: [], create: [], delete: [] };
  const watcher = {
    pattern,
    onDidChange(cb) { listeners.change.push(cb); return disposable('watcher.change', cb); },
    onDidCreate(cb) { listeners.create.push(cb); return disposable('watcher.create', cb); },
    onDidDelete(cb) { listeners.delete.push(cb); return disposable('watcher.delete', cb); },
    fireChange(uri) { listeners.change.forEach((cb) => cb(uri)); },
    fireCreate(uri) { listeners.create.forEach((cb) => cb(uri)); },
    fireDelete(uri) { listeners.delete.forEach((cb) => cb(uri)); },
    dispose() {},
  };
  state.watchers.push(watcher);
  return watcher;
}

const vscode = {
  Position,
  Range,
  Uri,
  MarkdownString,
  SnippetString,
  CompletionItem,
  CompletionItemKind,
  TextEdit,
  Location,
  DocumentLink,
  Hover,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  DocumentHighlight,
  Diagnostic,
  DiagnosticSeverity,
  WorkspaceEdit,
  CodeAction,
  CodeActionKind,
  workspace: {
    get isTrusted() {
      return state.workspaceTrusted;
    },
    get workspaceFolders() {
      return state.workspaceRoot ? [{ uri: Uri.file(state.workspaceRoot) }] : undefined;
    },
    getWorkspaceFolder(uri) {
      if (!state.workspaceRoot || !uri?.fsPath?.startsWith(state.workspaceRoot)) return undefined;
      return { uri: Uri.file(state.workspaceRoot) };
    },
    getConfiguration(section) {
      return {
        get(key, fallback) {
          const scoped = `${section}.${key}`;
          if (Object.prototype.hasOwnProperty.call(state.config, scoped)) return state.config[scoped];
          if (Object.prototype.hasOwnProperty.call(state.config, key)) return state.config[key];
          return fallback;
        },
      };
    },
    createFileSystemWatcher: createWatcher,
    fs: {
      createDirectory(uri) {
        state.commands.push({ command: 'workspace.fs.createDirectory', args: [uri] });
        return Promise.resolve(undefined);
      },
      writeFile(uri, content) {
        state.commands.push({ command: 'workspace.fs.writeFile', args: [uri, content] });
        return Promise.resolve(undefined);
      },
    },
    openTextDocument(uri) {
      state.commands.push({ command: 'workspace.openTextDocument', args: [uri] });
      return Promise.resolve({ uri });
    },
    get textDocuments() {
      return state.textDocuments;
    },
    onDidChangeConfiguration(cb) {
      state.configListeners.push(cb);
      return disposable('config', cb);
    },
    onDidOpenTextDocument(cb) {
      state.openDocumentListeners.push(cb);
      return disposable('document.open', cb);
    },
    onDidChangeTextDocument(cb) {
      state.changeDocumentListeners.push(cb);
      return disposable('document.change', cb);
    },
    onDidSaveTextDocument(cb) {
      state.saveDocumentListeners.push(cb);
      return disposable('document.save', cb);
    },
    onDidCloseTextDocument(cb) {
      state.closeDocumentListeners.push(cb);
      return disposable('document.close', cb);
    },
  },
  languages: {
    registerCompletionItemProvider(language, provider, ...triggers) {
      return register('completion', language, provider, triggers);
    },
    registerDefinitionProvider(language, provider) {
      return register('definition', language, provider);
    },
    registerDocumentLinkProvider(language, provider) {
      return register('link', language, provider);
    },
    registerHoverProvider(language, provider) {
      return register('hover', language, provider);
    },
    registerSignatureHelpProvider(language, provider, ...triggers) {
      return register('signature', language, provider, triggers);
    },
    registerDocumentHighlightProvider(language, provider) {
      return register('highlight', language, provider);
    },
    registerCodeActionsProvider(language, provider, metadata) {
      const entry = register('codeAction', language, provider);
      entry.payload.metadata = metadata;
      return entry;
    },
    createDiagnosticCollection(name) {
      const collection = {
        name,
        entries: new Map(),
        set(uri, diagnostics) {
          this.entries.set(uri.toString(), diagnostics);
          state.diagnostics.push({ name, uri, diagnostics });
        },
        delete(uri) {
          this.entries.delete(uri.toString());
        },
        clear() {
          this.entries.clear();
        },
        dispose() {
          this.clear();
        },
      };
      return collection;
    },
  },
  window: {
    createOutputChannel(name) {
      return {
        name,
        appendLine(message) { state.logs.push(`[${name}] ${message}`); },
        append(message) { state.logs.push(`[${name}] ${message}`); },
        dispose() {},
      };
    },
    onDidChangeTextEditorSelection(cb) {
      state.selectionListeners.push(cb);
      return disposable('selection', cb);
    },
    showTextDocument(doc) {
      state.commands.push({ command: 'window.showTextDocument', args: [doc] });
      return Promise.resolve(undefined);
    },
  },
  commands: {
    registerCommand(command, cb) {
      state.registeredCommands.push({ command, cb });
      return disposable('command', cb);
    },
    executeCommand(command, ...args) {
      state.commands.push({ command, args });
      return Promise.resolve(undefined);
    },
  },
  __mock: {
    state,
    reset() {
      state.workspaceRoot = '';
      state.config = {};
      state.registrations = [];
      state.subscriptions = [];
      state.selectionListeners = [];
      state.configListeners = [];
      state.openDocumentListeners = [];
      state.changeDocumentListeners = [];
      state.saveDocumentListeners = [];
      state.closeDocumentListeners = [];
      state.watchers = [];
      state.diagnostics = [];
      state.textDocuments = [];
      state.commands = [];
      state.registeredCommands = [];
      state.logs = [];
      state.workspaceTrusted = true;
    },
    setWorkspaceRoot(root) { state.workspaceRoot = root; },
    setWorkspaceTrusted(trusted) { state.workspaceTrusted = trusted; },
    setTextDocuments(docs) { state.textDocuments = [...docs]; },
    setConfig(config) { state.config = { ...config }; },
    fireConfigurationChange(section = 'hbsMaster') {
      state.configListeners.forEach((cb) => cb({
        affectsConfiguration(candidate) {
          return candidate === section || section.startsWith(`${candidate}.`);
        },
      }));
    },
    registrations(kind) { return kind ? state.registrations.filter((r) => r.kind === kind) : state.registrations; },
    lastRegistration(kind) { return this.registrations(kind).at(-1); },
  },
};

function installVscodeMock() {
  if (!installed) {
    originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'vscode') return vscode;
      return originalLoad.apply(this, arguments);
    };
    installed = true;
  }
  return vscode;
}

module.exports = { installVscodeMock, vscode };
