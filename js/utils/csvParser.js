/**
 * CSV Parser
 * Converts CSV text to JSON array of objects
 */

/**
 * Parse CSV string into array of objects
 * @param {string} csvText - Raw CSV text
 * @param {Object} options - Parser options
 * @param {boolean} options.header - First row is header (default: true)
 * @param {string} options.delimiter - Field delimiter (default: ',')
 * @returns {Array<Object>} Array of row objects
 */
export function parseCSV(csvText, options = {}) {
    const { header = true, delimiter = ',' } = options;

    // Normalize line endings
    const normalizedText = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Parse rows
    const rows = parseRows(normalizedText, delimiter);

    if (rows.length === 0) {
        return [];
    }

    // If no header, return array of arrays
    if (!header) {
        return rows;
    }

    // First row is headers
    const headers = rows[0].map(h => normalizeHeader(h));
    const data = [];

    // Convert remaining rows to objects
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        // Skip empty rows
        if (row.length === 1 && row[0] === '') {
            continue;
        }

        const obj = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = row[j] !== undefined ? row[j].trim() : '';
        }
        data.push(obj);
    }

    return data;
}

/**
 * Parse CSV rows handling quoted fields
 * @param {string} text - CSV text
 * @param {string} delimiter - Field delimiter
 * @returns {Array<Array<string>>} Array of row arrays
 */
function parseRows(text, delimiter) {
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // Escaped quote
                    currentField += '"';
                    i += 2;
                } else {
                    // End of quoted field
                    inQuotes = false;
                    i++;
                }
            } else {
                currentField += char;
                i++;
            }
        } else {
            if (char === '"') {
                // Start of quoted field
                inQuotes = true;
                i++;
            } else if (char === delimiter) {
                // End of field
                currentRow.push(currentField);
                currentField = '';
                i++;
            } else if (char === '\n') {
                // End of row
                currentRow.push(currentField);
                rows.push(currentRow);
                currentRow = [];
                currentField = '';
                i++;
            } else {
                currentField += char;
                i++;
            }
        }
    }

    // Don't forget the last field/row
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        rows.push(currentRow);
    }

    return rows;
}

/**
 * Normalize header name to camelCase
 * @param {string} header - Raw header string
 * @returns {string} Normalized header name
 */
function normalizeHeader(header) {
    // Trim and handle empty headers
    const trimmed = header.trim();
    if (!trimmed) return '';

    // Replace special characters with spaces
    const cleaned = trimmed
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Convert to camelCase
    const words = cleaned.split(' ');
    return words
        .map((word, index) => {
            if (index === 0) {
                return word.toLowerCase();
            }
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join('');
}

/**
 * Convert array of objects to CSV string
 * @param {Array<Object>} data - Array of row objects
 * @param {Array<string>} columns - Column names to include (optional)
 * @returns {string} CSV string
 */
export function toCSV(data, columns = null) {
    if (!data || data.length === 0) {
        return '';
    }

    // Get columns from first row if not provided
    const cols = columns || Object.keys(data[0]);

    // Header row
    const header = cols.map(escapeCSVField).join(',');

    // Data rows
    const rows = data.map(row => {
        return cols.map(col => escapeCSVField(row[col] ?? '')).join(',');
    });

    return [header, ...rows].join('\n');
}

/**
 * Escape a field for CSV output
 * @param {any} value - Field value
 * @returns {string} Escaped field
 */
function escapeCSVField(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Download data as CSV file
 * @param {Array<Object>} data - Data to download
 * @param {string} filename - File name (without extension)
 * @param {Array<string>} columns - Columns to include
 */
export function downloadCSV(data, filename, columns = null) {
    const csv = toCSV(data, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
}
