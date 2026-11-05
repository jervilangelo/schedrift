import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

/** A cell value as stored: text, a number (Excel dates are serial numbers) or empty. */
export type Cell = string | number | null;

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Workbook uses the 1904 date system (old Mac Excel). */
  date1904: boolean;
}

type Node = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ['sheet', 'Relationship', 'si', 'r', 'row', 'c'].includes(name),
});

function text(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  const n = node as Node;
  if ('#text' in n) return String(n['#text']);
  return '';
}

/** Rich text: concatenate every <t> under <si> or <is>. */
function richText(si: Node): string {
  if (si.t !== undefined) return text(si.t);
  const runs = (si.r as Node[] | undefined) ?? [];
  return runs.map((r) => text(r.t)).join('');
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Reads every worksheet of an .xlsx file (cell values only; formulas use their cached result). */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('This is not a readable .xlsx file. If it is an old .xls file, save it as .xlsx or .csv in Excel first.');
  }
  const read = (path: string) => (files[path] ? (parser.parse(strFromU8(files[path]!)) as Node) : undefined);
  const wb = read('xl/workbook.xml');
  if (!wb) throw new Error('The workbook has no xl/workbook.xml. Save it again from Excel as .xlsx.');
  const workbook = wb.workbook as Node;
  const date1904 = String((workbook.workbookPr as Node | undefined)?.['@date1904'] ?? '') === '1' || String((workbook.workbookPr as Node | undefined)?.['@date1904'] ?? '') === 'true';

  const rels = new Map<string, string>();
  const relDoc = read('xl/_rels/workbook.xml.rels');
  for (const r of ((relDoc?.Relationships as Node | undefined)?.Relationship as Node[] | undefined) ?? []) {
    const target = String(r['@Target']);
    rels.set(String(r['@Id']), target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
  }

  const shared: string[] = [];
  const sst = read('xl/sharedStrings.xml');
  for (const si of ((sst?.sst as Node | undefined)?.si as Node[] | undefined) ?? []) shared.push(richText(si));

  const sheets: Sheet[] = [];
  for (const s of ((workbook.sheets as Node | undefined)?.sheet as Node[] | undefined) ?? []) {
    const path = rels.get(String(s['@r:id'])) ?? '';
    const doc = read(path);
    if (!doc) continue;
    const rows: Cell[][] = [];
    const data = ((doc.worksheet as Node | undefined)?.sheetData as Node | undefined)?.row as Node[] | undefined;
    for (const row of data ?? []) {
      const r = Number(row['@r'] ?? rows.length + 1) - 1;
      const out: Cell[] = [];
      for (const c of (row.c as Node[] | undefined) ?? []) {
        const idx = colIndex(String(c['@r'] ?? ''));
        const t = String(c['@t'] ?? 'n');
        let v: Cell = null;
        if (t === 's') v = shared[Number(text(c.v))] ?? '';
        else if (t === 'inlineStr') v = richText((c.is as Node) ?? {});
        else if (t === 'str' || t === 'e') v = text(c.v);
        else if (t === 'b') v = text(c.v) === '1' ? 'TRUE' : 'FALSE';
        else if (c.v !== undefined) {
          const n = Number(text(c.v));
          v = Number.isFinite(n) ? n : text(c.v);
        }
        out[idx] = v;
      }
      rows[r] = Array.from(out, (x) => (x === undefined ? null : x));
    }
    sheets.push({ name: String(s['@name'] ?? 'Sheet'), rows: Array.from(rows, (x) => x ?? []), date1904 });
  }
  if (!sheets.length) throw new Error('The workbook contains no worksheets.');
  return sheets;
}

/** RFC 4180 CSV (comma, semicolon or tab separated). */
export function readCsv(textContent: string): Sheet[] {
  const src = textContent.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]!;
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(field === '' ? null : field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field === '' ? null : field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field === '' ? null : field); rows.push(row); }
  return [{ name: 'CSV', rows, date1904: false }];
}

export function readSpreadsheet(fileName: string, bytes: Uint8Array): Sheet[] {
  if (/\.(csv|txt|tsv)$/i.test(fileName)) return readCsv(new TextDecoder().decode(bytes));
  if (/\.xls$/i.test(fileName)) throw new Error('Old .xls files are not supported. In Excel, use File → Save As → Excel Workbook (.xlsx) or CSV.');
  return readXlsx(bytes);
}
