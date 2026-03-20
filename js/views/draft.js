/**
 * Draft View - Draft Board and Tools
 */

import { dataStore, showToast } from '../api/sheets.js';
import { draftStorage } from '../api/cache.js';
import { createDataTable, column } from '../components/dataTable.js';
import { createSearchBox, createPositionFilter } from '../components/searchBox.js';
import { sortBy, filterByPosition } from '../utils/dataTransform.js';

// State for comparison
let comparisonPlayers = [];
const MAX_COMPARE = 4;

/**
 * Render the draft view
 * @returns {HTMLElement} View element
 */
export async function renderDraft() {
    // Ensure data is loaded
    if (!dataStore.isLoaded) {
        await dataStore.loadAll();
    }

    const container = document.createElement('div');
    container.className = 'draft-view';

    // State
    let filters = {
        search: '',
        position: 'ALL',
        availability: 'available', // 'all', 'available', 'picked', 'watching'
    };

    let dataTable = null;

    /**
     * Get filtered draft board
     */
    function getFilteredPlayers() {
        // Get all players with rankings (draft eligible)
        let players = dataStore.players
            .filter(p => !p.isRostered) // Only show free agents for draft
            .map(p => ({
                ...p,
                isPicked: draftStorage.isPicked(p.mlbId),
                isWatching: draftStorage.isWatching(p.mlbId),
            }));

        // Apply search filter
        if (filters.search) {
            const q = filters.search.toLowerCase();
            players = players.filter(p =>
                p.name.toLowerCase().includes(q) ||
                (p.mlbTeam && p.mlbTeam.toLowerCase().includes(q))
            );
        }

        // Apply position filter
        players = filterByPosition(players, filters.position);

        // Apply availability filter
        switch (filters.availability) {
            case 'available':
                players = players.filter(p => !p.isPicked);
                break;
            case 'picked':
                players = players.filter(p => p.isPicked);
                break;
            case 'watching':
                players = players.filter(p => p.isWatching);
                break;
        }

        // Sort by rank, then by name
        return sortBy(players, 'rank', 'asc');
    }

    /**
     * Update the draft board
     */
    function updateBoard() {
        const players = getFilteredPlayers();

        if (dataTable) {
            dataTable.updateData(players);
        }

        // Update counts
        const countEl = container.querySelector('.draft-count');
        if (countEl) {
            const available = dataStore.players.filter(p => !p.isRostered && !draftStorage.isPicked(p.mlbId)).length;
            const watching = draftStorage.getWatching().length;
            const picked = draftStorage.getPicked().length;

            countEl.innerHTML = `
                <span class="badge">${available} Available</span>
                <span class="badge badge-warning">${watching} Watching</span>
                <span class="badge">${picked} Picked</span>
            `;
        }

        // Update comparison section
        updateComparison();
    }

    /**
     * Toggle player picked status
     */
    function togglePicked(player) {
        const newStatus = draftStorage.togglePicked(player.mlbId);
        showToast(`${player.name} ${newStatus ? 'marked as picked' : 'unmarked'}`, 'success');
        updateBoard();
    }

    /**
     * Toggle player watching status
     */
    function toggleWatching(player) {
        const newStatus = draftStorage.toggleWatching(player.mlbId);
        showToast(`${player.name} ${newStatus ? 'added to watchlist' : 'removed from watchlist'}`, 'success');
        updateBoard();
    }

    /**
     * Add player to comparison
     */
    function addToComparison(player) {
        if (comparisonPlayers.length >= MAX_COMPARE) {
            showToast(`Maximum ${MAX_COMPARE} players for comparison`, 'warning');
            return;
        }

        if (comparisonPlayers.find(p => p.mlbId === player.mlbId)) {
            showToast('Player already in comparison', 'warning');
            return;
        }

        comparisonPlayers.push(player);
        showToast(`${player.name} added to comparison`, 'success');
        updateComparison();
    }

    /**
     * Remove player from comparison
     */
    function removeFromComparison(mlbId) {
        comparisonPlayers = comparisonPlayers.filter(p => p.mlbId !== mlbId);
        updateComparison();
    }

    /**
     * Update comparison display
     */
    function updateComparison() {
        const comparisonEl = container.querySelector('#comparison-container');
        if (!comparisonEl) return;

        if (comparisonPlayers.length === 0) {
            comparisonEl.innerHTML = `
                <div class="empty-state p-md">
                    <p class="text-muted">Click "Compare" on players to add them here (max ${MAX_COMPARE})</p>
                </div>
            `;
            return;
        }

        const attributes = ['position', 'mlbTeam', 'age', 'bats', 'throws', 'fv', 'eta', 'rank'];

        comparisonEl.innerHTML = `
            <div class="comparison-container">
                <table class="data-table comparison-table">
                    <thead>
                        <tr>
                            <th>Attribute</th>
                            ${comparisonPlayers.map(p => `
                                <th>
                                    ${p.name}
                                    <button class="btn btn-sm btn-secondary ml-sm" onclick="removeCompare('${p.mlbId}')">
                                        &times;
                                    </button>
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${attributes.map(attr => `
                            <tr>
                                <td>${formatAttributeName(attr)}</td>
                                ${comparisonPlayers.map(p => `
                                    <td>${formatAttributeValue(attr, p[attr])}</td>
                                `).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="flex gap-sm mt-md">
                <button class="btn btn-secondary" onclick="clearComparison()">Clear All</button>
            </div>
        `;
    }

    // Build view HTML
    container.innerHTML = `
        <div class="view-header">
            <h1>Draft Tools</h1>
            <p>Draft board and player comparison</p>
        </div>

        <!-- Tabs -->
        <div class="tabs">
            <button class="tab active" data-tab="board">Draft Board</button>
            <button class="tab" data-tab="comparison">Player Comparison</button>
        </div>

        <!-- Draft Board Tab -->
        <div id="board-tab" class="tab-panel">
            <div class="filters-bar">
                <div class="filter-group flex-grow" id="search-container"></div>
                <div id="position-filter-container"></div>
                <div class="filter-group">
                    <label>Show</label>
                    <select id="availability-filter" class="filter-select">
                        <option value="available">Available</option>
                        <option value="all">All Players</option>
                        <option value="watching">Watching</option>
                        <option value="picked">Picked</option>
                    </select>
                </div>
                <div class="filter-group">
                    <button id="clear-picks-btn" class="btn btn-secondary btn-sm">
                        Clear Picks
                    </button>
                </div>
            </div>

            <div class="flex justify-between items-center mb-md">
                <div class="draft-count flex gap-sm"></div>
            </div>

            <div id="draft-table-container"></div>
        </div>

        <!-- Comparison Tab -->
        <div id="comparison-tab" class="tab-panel hidden">
            <div class="card">
                <div class="card-header">
                    <h3>Player Comparison</h3>
                </div>
                <div class="card-body" id="comparison-container">
                    <div class="empty-state p-md">
                        <p class="text-muted">Click "Compare" on players to add them here (max ${MAX_COMPARE})</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Tab switching
    const tabs = container.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.dataset.tab;
            container.querySelectorAll('.tab-panel').forEach(panel => {
                panel.classList.add('hidden');
            });
            container.querySelector(`#${tabName}-tab`).classList.remove('hidden');
        });
    });

    // Add search box
    const searchContainer = container.querySelector('#search-container');
    const searchBox = createSearchBox({
        placeholder: 'Search players...',
        onSearch: (value) => {
            filters.search = value;
            updateBoard();
        },
    });
    searchContainer.appendChild(searchBox);

    // Add position filter
    const positionFilterContainer = container.querySelector('#position-filter-container');
    const positionFilter = createPositionFilter({
        onChange: (position) => {
            filters.position = position;
            updateBoard();
        },
    });
    positionFilterContainer.appendChild(positionFilter);

    // Availability filter
    const availabilityFilter = container.querySelector('#availability-filter');
    availabilityFilter.addEventListener('change', (e) => {
        filters.availability = e.target.value;
        updateBoard();
    });

    // Clear picks button
    const clearPicksBtn = container.querySelector('#clear-picks-btn');
    clearPicksBtn.addEventListener('click', () => {
        if (confirm('Clear all picked players? This cannot be undone.')) {
            draftStorage.clear();
            showToast('All picks cleared', 'success');
            updateBoard();
        }
    });

    // Create data table
    const tableContainer = container.querySelector('#draft-table-container');
    dataTable = createDataTable({
        data: [],
        columns: [
            column('rank', '#', { type: 'number', sortable: true, align: 'center' }),
            column('name', 'Player', {
                sortable: true,
                render: (value, row) => {
                    let badges = '';
                    if (row.isPicked) {
                        badges += '<span class="badge ml-sm">Picked</span>';
                    }
                    if (row.isWatching) {
                        badges += '<span class="badge badge-warning ml-sm">Watching</span>';
                    }
                    return `<span class="font-bold">${value}</span>${badges}`;
                }
            }),
            column('position', 'Pos', { type: 'position', sortable: true }),
            column('mlbTeam', 'MLB', { sortable: true }),
            column('age', 'Age', { type: 'number', sortable: true, align: 'right' }),
            column('fv', 'FV', { sortable: true, align: 'center' }),
            {
                key: 'actions',
                header: 'Actions',
                sortable: false,
                render: (_, row) => `
                    <div class="flex gap-xs">
                        <button class="btn btn-sm ${row.isPicked ? 'btn-primary' : 'btn-secondary'}" data-action="pick" data-id="${row.mlbId}">
                            ${row.isPicked ? 'Unpick' : 'Pick'}
                        </button>
                        <button class="btn btn-sm ${row.isWatching ? 'btn-primary' : 'btn-secondary'}" data-action="watch" data-id="${row.mlbId}">
                            ${row.isWatching ? 'Unwatch' : 'Watch'}
                        </button>
                        <button class="btn btn-sm btn-secondary" data-action="compare" data-id="${row.mlbId}">
                            Compare
                        </button>
                    </div>
                `
            },
        ],
        title: 'Draft Board',
        showCount: false,
        pageSize: 50,
        emptyMessage: 'No players available',
        initialSort: 'rank',
    });
    tableContainer.appendChild(dataTable);

    // Handle action button clicks (event delegation)
    tableContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const mlbId = btn.dataset.id;
        const player = dataStore.getPlayer(mlbId);

        if (!player) return;

        switch (action) {
            case 'pick':
                togglePicked(player);
                break;
            case 'watch':
                toggleWatching(player);
                break;
            case 'compare':
                addToComparison(player);
                break;
        }
    });

    // Global functions for comparison
    window.removeCompare = function(mlbId) {
        removeFromComparison(mlbId);
    };

    window.clearComparison = function() {
        comparisonPlayers = [];
        updateComparison();
    };

    // Initial update
    updateBoard();

    return container;
}

/**
 * Format attribute name for display
 */
function formatAttributeName(attr) {
    const names = {
        position: 'Position',
        mlbTeam: 'MLB Team',
        age: 'Age',
        bats: 'Bats',
        throws: 'Throws',
        fv: 'Future Value',
        eta: 'ETA',
        rank: 'Rank',
    };
    return names[attr] || attr;
}

/**
 * Format attribute value for display
 */
function formatAttributeValue(attr, value) {
    if (value == null || value === '') return '-';

    if (attr === 'position') {
        return `<span class="position-badge position-${value}">${value}</span>`;
    }

    if (attr === 'rank') {
        return `#${value}`;
    }

    return value;
}
