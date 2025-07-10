import * as vscode from 'vscode';

export interface HbsDocProperty {
  name: string;
  type: string;
  description: string;
  optional: boolean;
  defaultValue?: string;
}

export interface HbsDocTypeAlias {
  name: string;
  body: string;
}

export interface HbsDocInfo {
  name?: string;
  description?: string;
  properties: HbsDocProperty[];
  types: HbsDocTypeAlias[];
}

export class HbsDocParser {
  /* ──────────────────────── PARSER ──────────────────────── */

  public static parseHbsDoc(text: string): HbsDocInfo | null {
    const m = text.match(/{{!--\s*([\s\S]*?)\s*--}}/);
    if (!m) return null;

    const lines = m[1].replace(/\r\n/g, '\n').split('\n').map(l => l.trim());

    const info: HbsDocInfo = { properties: [], types: [] };

    let i = 0;
    let pendingDesc: string | null = null;
    let pendingDef : string | null = null;
    let inParams   = false;
    let inType     = false;
    let curAlias   : HbsDocTypeAlias | null = null;

    /** Читает многострочный type начиная с firstLine.               *
     *  Останавливается, когда закрылся тот же уровень фигурных скобок
     *  и сразу после `}` идёт `;`, `,` или `[]` (для массивов объектов). */
    const readType = (first: string): string => {
      const clean = (l: string) =>
        l.startsWith('@description ')
          ? '// ' + l.slice(13).trim()
          : l.replace(/[;,]$/, '');

      let out = [clean(first)];
      let balance = first.split('{').length - first.split('}').length;

      while (++i < lines.length) {
        const l = lines[i];
        out.push(clean(l));
        balance += l.split('{').length - l.split('}').length;

        if (balance === 0) {                         // скобки сошлись
          // если следующая строка – это одинокие []
          if (lines[i + 1]?.trim() === '[]') {
            out[out.length - 1] += '[]';             // … превращаем в  }[]
            i++;                                     // и пропускаем её
          }
          break;
        }
      }
      return out.join('\n');
    };

    while (i < lines.length) {
      const line = lines[i];

      /* ───────── meta-теги ───────── */
      if (line.startsWith('@name '))       { info.name = line.slice(6).trim(); i++; continue; }
      if (/^@param(?:eter)?s\b/i.test(line)) {
        inParams = true;
        inType   = false;
        i++;
        continue;
      }
      if (line.startsWith('@type'))        { inType   = true;  inParams = false; curAlias = { name:'', body:'' }; i++; continue; }
      if (line.startsWith('@description ')){ pendingDesc = line.slice(13).trim(); i++; continue; }
      if (line.startsWith('@default '))    { pendingDef  = line.slice(9 ).trim().replace(/^"(.*)"$/, '$1'); i++; continue; }

      /* ───────── alias type body ─── */
      if (inType) {
        if (!curAlias!.name && line) {
          const [n, ...rest] = line.split(':');
          curAlias!.name = n.trim();
          curAlias!.body = rest.join(':').trim();
          if (curAlias!.body === '') { i++; continue; }
          curAlias!.body = readType(curAlias!.body);
        } else if (line) {
          curAlias!.body += '\n' + line;
        } else {
          info.types.push(curAlias!);
          curAlias = null; inType = false;
        }
        i++; continue;
      }

      /* ───────── параметры ───────── */
      if (inParams && line) {
        const pMatch = line.match(/^(\w+)(\?)?:\s*(.+)$/);
        if (pMatch) {
          const [ , pName, opt, typeStart] = pMatch;
          const fullType = readType(typeStart);

          info.properties.push({
            name        : pName,
            optional    : !!opt,
            type        : fullType,
            description : pendingDesc ?? '',
            defaultValue: pendingDef  ?? undefined,
          });

          pendingDesc = pendingDef = null;
          i++; continue;
        }
      }

      /* ───────── описание компонента ─ */
      if (line && !info.description && !inParams && !inType) {
        info.description = line;
      } else if (line && !inParams && !inType && info.description) {
        info.description += ' ' + line;
      }

      i++;
    }

    if (curAlias) info.types.push(curAlias);
    return info;
  }

  /* ─────────────────── Hover / Completion ─────────────────── */

  public static createHoverInfo(doc: HbsDocInfo): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = true;

    if (doc.name) md.appendMarkdown(`### ${doc.name}\n\n`);
    if (doc.description) md.appendMarkdown(`${doc.description}\n\n`);

    if (doc.properties.length) {
      md.appendMarkdown('**Свойства:**\n\n');

      for (const p of doc.properties) {
        // примитивы → в одну строку
        if (!p.type.includes('\n') && !p.type.startsWith('{')) {
          md.appendMarkdown(
            `- **${p.name}${p.optional ? '?' : ''}**: \`${p.type}\`` +
            (p.description ? ` — ${p.description}` : '') +
            (p.defaultValue ? ` *(по умолчанию \`${p.defaultValue}\`)*` : '') +
            '\n'
          );
          continue;
        }

        // объект или массив объектов
        md.appendMarkdown(
          `- **${p.name}${p.optional ? '?' : ''}**: ` +
          (p.type.trim().endsWith('[]') ? 'Object[]' : 'Object') +
          (p.description ? ` — ${p.description}` : '') +
          (p.defaultValue ? ` *(по умолчанию \`${p.defaultValue}\`)*` : '') +
          '\n'
        );
        md.appendMarkdown(this.formatObjectType(p.type, 1));
      }
    }

    if (doc.types.length) {
      md.appendMarkdown('\n**Alias-типы:**\n');
      doc.types.forEach(t => md.appendCodeblock(`${t.name}: ${t.body}`, 'ts'));
    }
    return md;
  }

  public static createCompletionItems(doc: HbsDocInfo): vscode.CompletionItem[] {
    return doc.properties.map(p => {
      const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Property);
      item.insertText = new vscode.SnippetString(
        p.type.includes('boolean')
          ? `${p.name}=\${1|true,false|}`
          : `${p.name}="\${1:${p.type}}"`
      );

      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${p.name}${p.optional ? '?' : ''}**: \`${p.type}\``);
      if (p.description) md.appendMarkdown(`\n\n${p.description}`);
      if (p.defaultValue) md.appendMarkdown(`\n\n*По умолчанию:* \`${p.defaultValue}\``);
      item.documentation = md;
      return item;
    });
  }

  /* ───────────── вспомогательные методы (без изменений) ─────────── */

  public static isInsideComponentTag(doc: vscode.TextDocument, pos: vscode.Position) {
    const line = doc.lineAt(pos.line).text;
    const before = line.slice(0, pos.character);
    const after  = line.slice(pos.character);
    return before.lastIndexOf('{{>') !== -1 && after.indexOf('}}') !== -1;
  }

  public static getComponentNameAtPosition(doc: vscode.TextDocument, pos: vscode.Position) {
    let start = Math.max(0, pos.line - 10);
    const end = Math.min(doc.lineCount - 1, pos.line + 10);
    let chunk = '';
    for (let i = start; i <= end; i++) chunk += doc.lineAt(i).text + '\n';

    const re = /{{>\s*'([^']+)'[\s\S]*?}}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk))) {
      const [all, name] = m;
      const sPos = this.indexToPosition(chunk, m.index, start);
      const ePos = this.indexToPosition(chunk, m.index + all.length, start);
      if (sPos && ePos &&
          pos.line >= sPos.line && pos.line <= ePos.line &&
          !(pos.line === sPos.line && pos.character < sPos.character) &&
          !(pos.line === ePos.line && pos.character > ePos.character))
        return name;
    }
    return null;
  }

  public static getCurrentParameter(doc: vscode.TextDocument, pos: vscode.Position) {
    const before = doc.lineAt(pos.line).text.slice(0, pos.character);
    const m = before.match(/(\w+)=("[^"]*"?|[^\s}]*)$/);
    return m ? m[1] : null;
  }

  private static indexToPosition(text: string, idx: number, offset: number) {
    const lines = text.slice(0, idx).split('\n');
    return new vscode.Position(offset + lines.length - 1, lines.pop()!.length);
  }

  /** Преобразует object‐type в вложенный bullet-list Markdown. */
  private static formatObjectType(type: string, level = 0): string {
    const pad = (n: number) => '    '.repeat(n);
    const lines = type.replace(/^{|}$/g, '')      // отрезаем внешние { }
                      .split('\n')
                      .map(l => l.trim())
                      .filter(Boolean);

    let i = 0, md = '';

    while (i < lines.length) {
      const cur = lines[i];

      // строка-комментарий («// …») — описание следующего свойства
      if (cur.startsWith('//')) { i++; continue; }

      const m = cur.match(/^([\w$]+)(\?)?:\s*(.+)$/);
      if (!m) { i++; continue; }

      const [, name, opt, rawType] = m;
      const desc = (i > 0 && lines[i - 1].startsWith('//'))
                ? lines[i - 1].slice(2).trim()
                : '';

      // ── вложенный object / object[] ──
      if (rawType.startsWith('{')) {
        const nested = this.collectBracedBlock(lines, i);

        // массив объектов, если после «}» стоят «[]» (в той же строке или отдельно)
        const hasArray = /\}\s*\[\]\s*$/.test(nested.body) ||
                        lines[nested.next]?.trim() === '[]';

        md += `${pad(level)}- **${name}${opt ? '?' : ''}**: ${hasArray ? 'Object[]' : 'Object'}`
            + (desc ? ` — ${desc}` : '') + '\n';

        // содержимое без обёртки «name: { … }»  (+ убираем [] у массива)
        const innerLines = nested.body.split('\n');
        innerLines.shift();                         // «name: {»
        innerLines.pop();                           // «}» или «}[]»
        const innerBody = innerLines.join('\n');

        md += this.formatObjectType(innerBody, level + 1);
        i = hasArray && lines[nested.next]?.trim() === '[]'
            ? nested.next + 1                       // пропускаем пустую строку «[]»
            : nested.next;
        continue;
      }

      // ── примитив / union ──
      md += `${pad(level)}- **${name}${opt ? '?' : ''}**: \`${rawType}\`${desc ? ` — ${desc}` : ''}\n`;
      i++;
    }
    return md;
  }


  /** Берёт строки начиная с i, пока не сойдётся «баланс» фигурных скобок. */
  private static collectBracedBlock(lines: string[], start: number) {
    let body: string[] = [];
    let balance = 0;
    let i = start;

    do {
      const l = lines[i];
      body.push(l);
      balance += (l.match(/{/g)?.length ?? 0) - (l.match(/}/g)?.length ?? 0);
      i++;
    } while (balance > 0 && i < lines.length);

    /* → если массив объектов заканчивается на "}[]",   убираем [] */
    const joined = body.join('\n').replace(/}\s*\[\]$/, '}');
    return { body: joined, next: i };
  }
}
