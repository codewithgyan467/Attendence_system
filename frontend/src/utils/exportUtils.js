/**
 * Universal Data Exporter: Supports both Excel (.xlsx) and CSV (.csv)
 * Formatted with clean column labels and automatic cell type detection.
 * Dynamically loads XLSX on demand to optimize initial mobile bundle size.
 */

async function getXlsx() {
  return await import('xlsx');
}

export async function exportToExcel({ filename, sheetName = 'Sheet1', data, headers }) {
  if (!data || data.length === 0) {
    alert('No data available to export.');
    return;
  }

  const XLSX = await getXlsx();

  let formattedData = data;
  if (headers && headers.length > 0) {
    formattedData = data.map((item) => {
      const row = {};
      headers.forEach((h) => {
        const val = item[h.key];
        row[h.label || h.key] = val !== undefined && val !== null ? val : '';
      });
      return row;
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(formattedData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const cleanName = filename.toLowerCase().endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(workbook, cleanName);
}

export async function exportToCsv({ filename, data, headers }) {
  if (!data || data.length === 0) {
    alert('No data available to export.');
    return;
  }

  const XLSX = await getXlsx();

  let formattedData = data;
  if (headers && headers.length > 0) {
    formattedData = data.map((item) => {
      const row = {};
      headers.forEach((h) => {
        const val = item[h.key];
        row[h.label || h.key] = val !== undefined && val !== null ? val : '';
      });
      return row;
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(formattedData);
  const csvContent = XLSX.utils.sheet_to_csv(worksheet);

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const cleanName = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  link.setAttribute('download', cleanName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generic export helper that takes format ('csv' or 'excel')
 */
export async function exportReport(format, options) {
  if (format === 'excel' || format === 'xlsx') {
    await exportToExcel(options);
  } else {
    await exportToCsv(options);
  }
}

