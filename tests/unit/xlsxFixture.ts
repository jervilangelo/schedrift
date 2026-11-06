import { strToU8, zipSync } from 'fflate';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Builds a minimal but valid .xlsx (one sheet, shared strings for text, numbers as values). */
export function makeXlsx(rows: (string | number | null)[][], sheetName = 'Master Data'): Uint8Array {
  const strings: string[] = [];
  const idx = (s: string) => {
    let i = strings.indexOf(s);
    if (i < 0) { strings.push(s); i = strings.length - 1; }
    return i;
  };
  const sheetRows = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${col(ci)}${ri + 1}`;
    if (v === null || v === '') return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="s"><v>${idx(v)}</v></c>`;
  }).join('')}</row>`).join('');
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  };
  files['xl/sharedStrings.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`);
  return zipSync(files);
}

/** Excel serial number for a date (1900 date system). */
export const serial = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000 + 25569;

/** A master sheet for the Atlas sample shaped like a real planning workbook. */
export function atlasMaster(): (string | number | null)[][] {
  return [
    ['Atlas ERP Rollout — master schedule'],
    ['Milestone & Task Breakdown', 'Project Phase', 'Owner', 'Status', 'Planned Start', 'Planned End', 'Planned No. Of Days', 'Actual Start', 'Actual End', 'RAG'],
    ['   Functional design', 'Phase 1', 'Team A', 'Completed', 'Fri Aug-21-2026', 'Fri Sep-11-2026', 15, '21/Aug/26', '11/Sep/26', 'On track'],
    ['4 Testing', 'Phase 1', null, 'Yet to start', 'Tue Jan-05-2027', 'Thu Mar-04-2027', 40, null, null, 'On track'],
    ['   User acceptance testng (UAT)', 'Phase 1', 'Team B', 'Yet to start', 'Tue Feb-02-2027', 'Mon Feb-22-2027', 15, null, null, 'On track'],
    ['   Training materials', 'Phase 1', 'Team A', 'Yet to start', 'Mon Nov-02-2026', 'Fri Nov-13-2026', 10, null, null, 'On track'],
    ['   UAT sign-off', 'Phase 1', 'Team B', 'Yet to start', 'Mon Feb-22-2027', 'Mon Feb-22-2027', 1, null, null, 'On track'],
    ['         Vendor portal setup', 'Phase 1', 'Team B', 'Yet to start', 'Wed Jan-20-2027', 'Wed Jan-20-2027', 1, null, null, 'On track'],
    ['   Cutover rehearsal', 'Phase 1', 'Team A', 'Yet to start', serial(2027, 2, 23), serial(2027, 3, 1), 5, null, null, 'On track'],
    ['   Production migration', 'Phase 1', 'Team A', 'Yet to start', 'Tue Mar-02-2027', 'Thu Mar-04-2027', 3, null, null, 'On track'],
    ['   Go-Live', 'Phase 1', 'All', 'Yet to start', 'Thu Mar-04-2027', 'Thu Mar-04-2027', 1, null, null, 'On track'],
  ];
}
