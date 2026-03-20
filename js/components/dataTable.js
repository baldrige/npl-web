/**
 * Data Table Component
 * Sortable, paginated table for displaying data
 */

import { sortBy } from '../utils/dataTransform.js';

/**
 * Create a data table
 * @param {Object} options - Table options
 * @returns {HTMLElement} Table wrapper element
 */
export function createDataTable(options) {
    const {
        data = [],
        columns = [],
        title = '',
        pageSize = 25,
        sortable = true,
        clickable = false,
        onRowClick = null,
        emptyMessage = 'No data available',
        showCount = true,
        initialSort = null,
        initialSortDir = 'asc',
    } = options;

    // State
    let currentData = [...data];
    let currentPage = 1;
    let sortColumn = initialSort;
    let sortDirection = initialSortDir;

    // Apply initial sort
    if (sortColumn) {
        currentData = sortBy(currentData, sortColumn, sortDirection);
    }

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'data-table-wrapper';

    /**
     * Render the table
     */
    function render() {
        const totalPages = Math.ceil(currentData.length / pageSize);
        const startIdx = (currentPage - 1) * pageSize;
        const endIdx = Math.min(startIdx + pageSize, currentData.length);
        const pageData = currentData.slice(startIdx, endIdx);

        wrapper.innerHTML = `
            ${title || showCount ? `
                <div class="data-table-header">
                    ${title ? `<span class="data-table-title">${title}</span>` : ''}
                    ${showCount ? `<span class="data-table-count">${currentData.length} records</span>` : ''}
                </div>
            ` : ''}
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            ${columns.map(col => `
                                <th
                                    class="${sortable && col.sortable !== false ? 'sortable' : ''} ${sortColumn === col.key ? (sortDirection === 'asc' ? 'sort-asc' : 'sort-desc') : ''} ${col.align ? 'text-' + col.align : ''}"
                                    data-key="${col.key}"
                                >
                                    ${col.header}
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${pageData.length > 0 ? pageData.map((row, idx) => `
                            <tr class="${clickable ? 'clickable' : ''}" data-index="${startIdx + idx}">
                                ${columns.map(col => `
                                    <td class="${col.align ? 'text-' + col.align : ''}">
                                        ${formatCell(row, col)}
                                    </td>
                                `).join('')}
                            </tr>
                        `).join('') : `
                            <tr>
                                <td colspan="${columns.length}" class="text-center text-muted p-lg">
                                    ${emptyMessage}
                                </td>
                            </tr>
                        `}
                    </tbody>
                </table>
            </div>
            ${totalPages > 1 ? `
                <div class="data-table-footer">
                    <span class="pagination-info">
                        Showing ${startIdx + 1}-${endIdx} of ${currentData.length}
                    </span>
                    <div class="pagination">
                        <button class="pagination-btn" data-action="first" ${currentPage === 1 ? 'disabled' : ''}>
                            &laquo;
                        </button>
                        <button class="pagination-btn" data-action="prev" ${currentPage === 1 ? 'disabled' : ''}>
                            &lsaquo;
                        </button>
                        <span class="pagination-info">Page ${currentPage} of ${totalPages}</span>
                        <button class="pagination-btn" data-action="next" ${currentPage === totalPages ? 'disabled' : ''}>
                            &rsaquo;
                        </button>
                        <button class="pagination-btn" data-action="last" ${currentPage === totalPages ? 'disabled' : ''}>
                            &raquo;
                        </button>
                    </div>
                </div>
            ` : ''}
        `;

        // Attach event listeners
        attachEvents();
    }

    /**
     * Format cell content
     * @param {Object} row - Row data
     * @param {Object} col - Column definition
     * @returns {string} Formatted cell HTML
     */
    function formatCell(row, col) {
        const value = row[col.key];

        // Custom renderer
        if (col.render) {
            return col.render(value, row);
        }

        // Position badge
        if (col.type === 'position' && value) {
            return `<span class="position-badge position-${value}">${value}</span>`;
        }

        // Badge
        if (col.type === 'badge' && value) {
            return `<span class="badge">${value}</span>`;
        }

        // Number formatting
        if (col.type === 'number' && value != null) {
            return Number(value).toLocaleString();
        }

        // Percentage
        if (col.type === 'percent' && value != null) {
            return (Number(value) * 100).toFixed(1) + '%';
        }

        // Default
        return value ?? '';
    }

    /**
     * Attach event listeners
     */
    function attachEvents() {
        // Sort headers
        if (sortable) {
            wrapper.querySelectorAll('th.sortable').forEach(th => {
                th.addEventListener('click', () => {
                    const key = th.dataset.key;
                    if (sortColumn === key) {
                        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        sortColumn = key;
                        sortDirection = 'asc';
                    }
                    currentData = sortBy(currentData, sortColumn, sortDirection);
                    currentPage = 1;
                    render();
                });
            });
        }

        // Row clicks
        if (clickable && onRowClick) {
            wrapper.querySelectorAll('tbody tr.clickable').forEach(tr => {
                tr.addEventListener('click', () => {
                    const idx = parseInt(tr.dataset.index);
                    onRowClick(currentData[idx], idx);
                });
            });
        }

        // Pagination
        wrapper.querySelectorAll('.pagination-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                const totalPages = Math.ceil(currentData.length / pageSize);

                switch (action) {
                    case 'first':
                        currentPage = 1;
                        break;
                    case 'prev':
                        currentPage = Math.max(1, currentPage - 1);
                        break;
                    case 'next':
                        currentPage = Math.min(totalPages, currentPage + 1);
                        break;
                    case 'last':
                        currentPage = totalPages;
                        break;
                }
                render();
            });
        });
    }

    /**
     * Update table data
     * @param {Array} newData - New data array
     */
    wrapper.updateData = function(newData) {
        currentData = [...newData];
        if (sortColumn) {
            currentData = sortBy(currentData, sortColumn, sortDirection);
        }
        currentPage = 1;
        render();
    };

    /**
     * Get current data
     * @returns {Array} Current data
     */
    wrapper.getData = function() {
        return currentData;
    };

    // Initial render
    render();

    return wrapper;
}

/**
 * Helper to create column definitions
 * @param {string} key - Data key
 * @param {string} header - Column header
 * @param {Object} options - Additional options
 * @returns {Object} Column definition
 */
export function column(key, header, options = {}) {
    return {
        key,
        header,
        ...options,
    };
}

/**
 * Common column definitions for player tables
 */
export const playerColumns = {
    name: column('name', 'Name', { sortable: true }),
    position: column('position', 'Pos', { type: 'position', sortable: true }),
    mlbTeam: column('mlbTeam', 'MLB', { sortable: true }),
    nplTeam: column('nplTeam', 'NPL Team', { sortable: true }),
    age: column('age', 'Age', { type: 'number', sortable: true, align: 'right' }),
    rank: column('rank', 'Rank', { type: 'number', sortable: true, align: 'right' }),
    fv: column('fv', 'FV', { sortable: true, align: 'center' }),
};
