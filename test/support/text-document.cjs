const { vscode } = require('./vscode-mock.cjs');

class TestTextDocument {
  constructor(text, fsPath = '/test/document.hbs') {
    this._text = text.replace(/\r\n/g, '\n');
    this._lines = this._text.split('\n');
    this.lineCount = this._lines.length;
    this.uri = vscode.Uri.file(fsPath);
  }

  lineAt(lineOrPosition) {
    const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
    return { text: this._lines[line] ?? '' };
  }

  getText(range) {
    if (!range) return this._text;
    return this._text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  positionAt(offset) {
    const bounded = Math.max(0, Math.min(offset, this._text.length));
    let current = 0;
    for (let line = 0; line < this._lines.length; line++) {
      const lineLength = this._lines[line].length;
      if (bounded <= current + lineLength) {
        return new vscode.Position(line, bounded - current);
      }
      current += lineLength + 1;
    }
    const last = this._lines.length - 1;
    return new vscode.Position(last, this._lines[last].length);
  }

  offsetAt(position) {
    let offset = 0;
    for (let line = 0; line < position.line; line++) {
      offset += (this._lines[line] ?? '').length + 1;
    }
    return offset + position.character;
  }
}

function positionOf(document, needle, delta = 0) {
  const index = document.getText().indexOf(needle);
  if (index === -1) throw new Error(`Needle not found: ${needle}`);
  return document.positionAt(index + delta);
}

function positionAfter(document, needle) {
  return positionOf(document, needle, needle.length);
}

module.exports = { TestTextDocument, positionOf, positionAfter };
