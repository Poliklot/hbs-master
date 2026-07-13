import * as vscode from 'vscode';
import { getHashPairAtPosition, getPartialInvocationAtPosition } from './utils/partials';

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

export interface HbsDocHoverOptions {
  componentPath?: string;
  source?: string;
  missingRequired?: string[];
  usedParameters?: string[];
}

export class HbsDocParser {
  /* ──────────────────────── PARSER ──────────────────────── */

  public static parseHbsDoc(text: string): HbsDocInfo | null {
    const commentRe = /{{!--\s*([\s\S]*?)\s*--}}/g;
    let m: RegExpExecArray | null;
    let block: string | null = null;

    while ((m = commentRe.exec(text))) {
      if (/^\s*@(name|param(?:eter)?s|parametrs|description|default|type)\b/im.test(m[1])) {
        block = m[1];
        break;
      }
    }

    if (!block) return null;

    const lines = block.replace(/\r\n/g, '\n').split('\n').map(l => l.trim());

    const info: HbsDocInfo = { properties: [], types: [] };

    let i = 0;
    let pendingDesc: string | null = null;
    let pendingDef : string | null = null;
    let inParams   = false;
    let inType     = false;
    let curAlias   : HbsDocTypeAlias | null = null;

    const braceDelta = (value: string): number => {
      let quote: string | null = null;
      let balance = 0;

      for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
          if (character === '\\') index++;
          else if (character === quote) quote = null;
          continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === '{') balance++;
        else if (character === '}') balance--;
      }

      return balance;
    };

    /** Читает многострочный type начиная с firstLine.               *
     *  Останавливается, когда закрылся тот же уровень фигурных скобок
     *  и сразу после `}` идёт `;`, `,` или `[]` (для массивов объектов). */
    const readType = (first: string): string => {
      const clean = (l: string) =>
        l.startsWith('@description ')
          ? '// ' + l.slice(13).trim()
          : l.replace(/\s+\/\/.*$/, '').replace(/[;,]$/, '');

      let out = [clean(first)];
      let balance = braceDelta(first);

      if (balance === 0) {
        if (lines[i + 1]?.trim() === '[]') {
          out[out.length - 1] += '[]';
          i++;
        }
        return out.join('\n');
      }

      while (++i < lines.length) {
        const l = lines[i];
        out.push(clean(l));
        balance += braceDelta(l);

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
      const nameTag = line.match(/^@name\s+(.+)$/i);
      if (nameTag) { info.name = nameTag[1].trim(); i++; continue; }
      if (/^@(param(?:eter)?s|parametrs)\b/i.test(line)) {
        if (curAlias?.name) info.types.push(curAlias);
        curAlias = null;
        inParams = true;
        inType   = false;
        i++;
        continue;
      }
      const typeTag = line.match(/^@type\b\s*(.*)$/i);
      if (typeTag) {
        if (curAlias?.name) info.types.push(curAlias);
        inType = true;
        inParams = false;
        curAlias = { name: '', body: '' };

        const inlineAlias = typeTag[1].trim();
        if (inlineAlias) {
          const [name, ...rest] = inlineAlias.split(':');
          curAlias.name = name.trim();
          curAlias.body = rest.join(':').trim();
          if (curAlias.body) curAlias.body = readType(curAlias.body);
        }
        i++;
        continue;
      }
      const descriptionTag = line.match(/^@description\s+(.+)$/i);
      if (!inType && descriptionTag) {
        const desc = descriptionTag[1].trim();
        if (inParams) {
          pendingDesc = desc;
        } else {
          info.description = info.description ? `${info.description} ${desc}` : desc;
        }
        i++;
        continue;
      }
      const defaultTag = line.match(/^@default\s+(.+)$/i);
      if (defaultTag) {
        pendingDef = defaultTag[1].trim().replace(/^(['"])(.*)\1$/, '$2');
        i++;
        continue;
      }

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
          if (curAlias?.name) info.types.push(curAlias);
          curAlias = null; inType = false;
        }
        i++; continue;
      }

      /* ───────── параметры ───────── */
      if (inParams && line) {
        const pMatch = line.match(/^([\w-]+)(\?)?:\s*(.+)$/);
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

    if (curAlias?.name) info.types.push(curAlias);
    return info;
  }

  /* ─────────────────── Hover / Completion ─────────────────── */

  public static createHoverInfo(doc: HbsDocInfo, options: HbsDocHoverOptions = {}): vscode.MarkdownString {
    const md = this.createMarkdown();

    const title = doc.name ?? options.componentPath;
    if (title) md.appendMarkdown(`### ${title}\n\n`);
    if (doc.description) md.appendMarkdown(`${doc.description}\n\n`);

    if (options.missingRequired?.length) {
      md.appendMarkdown(
        `⚠️ **Missing required in this call:** ${options.missingRequired.map(this.inlineCode).join(', ')}\n\n`
      );
    }

    if (doc.properties.length) {
      md.appendMarkdown('**Properties:**\n\n');

      for (const p of doc.properties) {
        const requirement = ` _(${p.optional ? 'optional' : 'required'})_`;
        const defaultValue = p.defaultValue !== undefined
          ? ` *(default: ${this.inlineCode(p.defaultValue)})*`
          : '';

        // примитивы → в одну строку
        if (!p.type.includes('\n') && !p.type.startsWith('{')) {
          md.appendMarkdown(
            `- **${p.name}${p.optional ? '?' : ''}**: ${this.inlineCode(p.type)}${requirement}` +
            (p.description ? ` — ${p.description}` : '') +
            defaultValue +
            '\n'
          );
          continue;
        }

        // объект или массив объектов
        md.appendMarkdown(
          `- **${p.name}${p.optional ? '?' : ''}**: ` +
          `${p.type.trim().endsWith('[]') ? 'Object[]' : 'Object'}${requirement}` +
          (p.description ? ` — ${p.description}` : '') +
          defaultValue +
          '\n'
        );
        md.appendMarkdown(this.formatObjectType(p.type, 1));
      }
    }

    if (doc.types.length) {
      md.appendMarkdown('\n**Type aliases:**\n');
      doc.types.forEach(t => md.appendCodeblock(`${t.name}: ${t.body}`, 'ts'));
    }

    this.appendSource(md, options.source);
    return md;
  }

  public static createParameterHoverInfo(
    doc: HbsDocInfo,
    property: HbsDocProperty,
    options: HbsDocHoverOptions = {}
  ): vscode.MarkdownString {
    const md = this.createMarkdown();
    const displayType = this.getDisplayType(property.type);

    md.appendMarkdown(`**${property.name}${property.optional ? '?' : ''}**: ${this.inlineCode(displayType)}\n\n`);
    md.appendMarkdown(`${property.optional ? 'Optional' : 'Required'}.`);
    if (property.defaultValue !== undefined) md.appendMarkdown(` Default: ${this.inlineCode(property.defaultValue)}.`);
    md.appendMarkdown('\n\n');

    if (property.description) md.appendMarkdown(`${property.description}\n\n`);

    this.appendAllowedValues(md, property.type);

    if (this.isObjectType(property.type)) {
      md.appendMarkdown('**Shape:**\n\n');
      md.appendMarkdown(this.formatObjectType(property.type, 0));
      md.appendMarkdown('\n');
    }

    const aliases = this.findReferencedTypes(property.type, doc.types);
    if (aliases.length) {
      md.appendMarkdown('**Type aliases:**\n');
      aliases.forEach(alias => md.appendCodeblock(`${alias.name}: ${alias.body}`, 'ts'));
    }

    this.appendSource(md, options.source);
    return md;
  }

  public static createUnknownParameterHoverInfo(
    parameterName: string,
    doc: HbsDocInfo,
    options: HbsDocHoverOptions = {}
  ): vscode.MarkdownString {
    const md = this.createMarkdown();
    md.appendMarkdown(`**Unknown parameter ${this.inlineCode(parameterName)}**\n\n`);

    const component = doc.name ?? options.componentPath;
    if (component) md.appendMarkdown(`${this.inlineCode(component)} does not document this parameter.\n\n`);

    const suggestion = this.findClosestPropertyName(parameterName, doc.properties.map(property => property.name));
    if (suggestion) md.appendMarkdown(`Did you mean ${this.inlineCode(suggestion)}?\n\n`);

    if (doc.properties.length) {
      md.appendMarkdown(`Known parameters: ${doc.properties.map(property => this.inlineCode(property.name)).join(', ')}.\n`);
    }

    this.appendSource(md, options.source);
    return md;
  }

  public static createInvocationSummaryHoverInfo(
    doc: HbsDocInfo,
    options: HbsDocHoverOptions = {}
  ): vscode.MarkdownString {
    const md = this.createMarkdown();
    const title = doc.name ?? options.componentPath ?? 'Partial';
    md.appendMarkdown(`**${title}**`);
    if (options.componentPath && options.componentPath !== title) {
      md.appendMarkdown(` ${this.inlineCode(options.componentPath)}`);
    }

    if (doc.description) md.appendMarkdown(`\n\n${this.truncate(doc.description, 180)}`);

    if (options.missingRequired?.length) {
      md.appendMarkdown(
        `\n\n⚠️ **Missing required:** ${options.missingRequired.map(this.inlineCode).join(', ')}`
      );
    }

    if (doc.properties.length) {
      const parameterList = doc.properties
        .slice(0, 8)
        .map(property => this.inlineCode(`${property.name}${property.optional ? '?' : ''}`));
      const suffix = doc.properties.length > parameterList.length ? `, +${doc.properties.length - parameterList.length} more` : '';
      md.appendMarkdown(`\n\nParameters: ${parameterList.join(', ')}${suffix}.`);
    }

    if (options.usedParameters?.length) {
      md.appendMarkdown(`\n\nUsed in this call: ${options.usedParameters.map(this.inlineCode).join(', ')}.`);
    }

    this.appendSource(md, options.source);
    return md;
  }

  public static createCompletionItems(doc: HbsDocInfo): vscode.CompletionItem[] {
    return doc.properties.map(p => {
      const item = new vscode.CompletionItem(p.name, vscode.CompletionItemKind.Property);
      item.insertText = new vscode.SnippetString(this.createParameterSnippet(p));
      item.detail = `${p.optional ? 'Optional' : 'Required'} HBSDoc parameter · ${this.getDisplayType(p.type)}`;

      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${p.name}${p.optional ? '?' : ''}**: ${this.inlineCode(p.type)}`);
      if (p.description) md.appendMarkdown(`\n\n${p.description}`);
      if (p.defaultValue !== undefined) md.appendMarkdown(`\n\n*Default:* ${this.inlineCode(p.defaultValue)}`);
      item.documentation = md;
      return item;
    });
  }

  /* ───────────── вспомогательные методы (без изменений) ─────────── */

  /**
   * Проверяет, находится ли позиция внутри открытого {{> … }} —
   * корректно работает и для многострочных вызовов.
   */
  public static isInsideComponentTag(doc: vscode.TextDocument, pos: vscode.Position): boolean {
    return !!getPartialInvocationAtPosition(doc, pos);
  }

  public static getComponentNameAtPosition(doc: vscode.TextDocument, pos: vscode.Position) {
    return getPartialInvocationAtPosition(doc, pos)?.component ?? null;
  }

  public static getCurrentParameter(doc: vscode.TextDocument, pos: vscode.Position) {
    return getHashPairAtPosition(doc, pos)?.name ?? null;
  }

  private static createMarkdown(): vscode.MarkdownString {
    return new vscode.MarkdownString();
  }

  private static escapeSnippetPlaceholder(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\$/g, '\\$').replace(/}/g, '\\}');
  }

  private static escapeSnippetChoice(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/[,|]/g, match => `\\${match}`);
  }

  private static createParameterSnippet(property: HbsDocProperty): string {
    const type = property.type.trim().replace(/\s+/g, ' ');

    if (property.defaultValue !== undefined) {
      const value = this.escapeSnippetPlaceholder(property.defaultValue.replace(/^(['"])(.*)\1$/, '$2'));
      if (type === 'boolean' || /^(?:number|bigint)$/.test(type)) {
        return `${property.name}=\${1:${value}}`;
      }
      return `${property.name}="\${1:${value}}"`;
    }

    if (type === 'boolean') return `${property.name}=\${1|true,false|}`;
    if (/^(?:number|bigint)$/.test(type)) return `${property.name}=\${1:0}`;

    const unionParts = type.split('|').map(part => part.trim()).filter(Boolean);
    const literalValues = unionParts.map(part => part.match(/^(['"])(.*)\1$/)?.[2]);
    if (unionParts.length > 1 && literalValues.every((value): value is string => value !== undefined)) {
      const choices = literalValues.map(this.escapeSnippetChoice).join(',');
      return `${property.name}="\${1|${choices}|}"`;
    }

    const singleLiteral = type.match(/^(['"])(.*)\1$/)?.[2];
    if (singleLiteral !== undefined) {
      return `${property.name}="\${1:${this.escapeSnippetPlaceholder(singleLiteral)}}"`;
    }

    if (type === 'string' || type === 'unknown' || type === 'any') {
      return `${property.name}="\${1}"`;
    }

    return `${property.name}=\${1}`;
  }

  private static inlineCode(value: string): string {
    const backtickRuns = value.match(/`+/g)?.map(run => run.length) ?? [0];
    const delimiter = '`'.repeat(Math.max(...backtickRuns) + 1);
    return `${delimiter}${value}${delimiter}`;
  }

  private static appendSource(md: vscode.MarkdownString, source?: string) {
    if (source) md.appendMarkdown(`\n\n---\nDefined in: ${this.inlineCode(source)}\n`);
  }

  private static getDisplayType(type: string): string {
    if (this.isObjectType(type)) return type.trim().endsWith('[]') ? 'Object[]' : 'Object';
    return type.trim().replace(/\s+/g, ' ');
  }

  private static isObjectType(type: string): boolean {
    return type.trim().startsWith('{') || type.includes('\n');
  }

  private static appendAllowedValues(md: vscode.MarkdownString, type: string) {
    const values = this.getAllowedValues(type);
    if (!values.length) return;

    md.appendMarkdown('**Allowed values:**\n\n');
    values.forEach(value => md.appendMarkdown(`- ${this.inlineCode(value)}\n`));
    md.appendMarkdown('\n');
  }

  private static getAllowedValues(type: string): string[] {
    const normalized = type.trim();
    if (normalized === 'boolean') return ['true', 'false'];
    if (this.isObjectType(normalized)) return [];

    const unionParts = normalized.split('|').map(part => part.trim()).filter(Boolean);
    return unionParts.length > 1 ? unionParts : [];
  }

  private static findReferencedTypes(type: string, aliases: HbsDocTypeAlias[]): HbsDocTypeAlias[] {
    return aliases.filter(alias => {
      const escapedName = alias.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^\\w$])${escapedName}($|[^\\w$])`).test(type);
    });
  }

  private static findClosestPropertyName(input: string, candidates: string[]): string | undefined {
    let best: { name: string; distance: number } | null = null;

    for (const candidate of candidates) {
      const distance = this.editDistance(input.toLowerCase(), candidate.toLowerCase());
      if (!best || distance < best.distance) best = { name: candidate, distance };
    }

    if (!best) return undefined;
    const threshold = Math.max(2, Math.floor(Math.max(input.length, best.name.length) / 3));
    return best.distance <= threshold ? best.name : undefined;
  }

  private static editDistance(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = Array.from({ length: b.length + 1 }, () => 0);

    for (let i = 1; i <= a.length; i++) {
      current[0] = i;
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      for (let j = 0; j <= b.length; j++) previous[j] = current[j];
    }

    return previous[b.length];
  }

  private static truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
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
        const hasArray = nested.isArray ||
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
    const rawBody = body.join('\n');
    const isArray = /}\s*\[\]\s*$/.test(rawBody);
    const joined = rawBody.replace(/}\s*\[\]\s*$/, '}');
    return { body: joined, next: i, isArray };
  }
}
