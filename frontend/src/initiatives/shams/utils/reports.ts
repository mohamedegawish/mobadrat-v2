// تصدير التقارير — CSV / Excel (xlsx يُحمّل عند الطلب فقط لتخفيف الحزمة الأولى).
import type * as XLSXType from 'xlsx';

const loadXlsx = () => import('xlsx');
type WorkBook = XLSXType.WorkBook;
type Cell = string | number | boolean | null | undefined;

function csvCell(v: Cell): string {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCSV(filename: string, headers: string[], rows: Cell[][]) {
  const csv = '﻿' + [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

function sheetFrom(XLSX: typeof import('xlsx'), headers: string[], rows: Cell[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h, ci) => {
    let maxLen = h.length;
    for (let ri = 0; ri < Math.min(rows.length, 30); ri++) {
      const len = String(rows[ri]?.[ci] ?? '').length;
      if (len > maxLen) maxLen = len;
    }
    return { wch: Math.min(maxLen + 4, 60) };
  });
  (ws as Record<string, unknown>)['!autofilter'] = { ref: ws['!ref'] };
  return ws;
}

function saveWorkbook(XLSX: typeof import('xlsx'), wb: WorkBook, filename: string) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}

export async function downloadExcel(filename: string, headers: string[], rows: Cell[][], sheetName = 'Report') {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, headers, rows), sheetName.slice(0, 31));
  saveWorkbook(XLSX, wb, filename);
}

export async function downloadMultiSheetExcel(sheets: { name: string; headers: string[]; rows: Cell[][] }[], filename: string) {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, s.headers, s.rows), s.name.slice(0, 31));
  saveWorkbook(XLSX, wb, filename);
}

/** حفظ ملف تم تنزيله (Blob) باسم معين. */
export function saveFile(blob: Blob, filename: string) {
  saveBlob(blob, filename);
}
