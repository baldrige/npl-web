/**
 * Scoresheet Check View
 * Compares Scoresheet rosters with NPL rosters to find mismatches.
 */

import { dataStore, showToast } from '../api/sheets.js';
import { loadScoresheetData, compareScoresheetWithNPL } from '../api/scoresheet.js';
import { createDataTable, column } from '../components/dataTable.js';
import { createSearchBox, createFilterSelect } from '../components/searchBox.js';
import { downloadCSV } from '../utils/csvParser.js';
import { filterBySearch } from '../utils/dataTransform.js';

export async function renderScoresheetCheck(params = {}) {
    // Ensure NPL data is loaded
    if (!dataStore.isLoaded) await dataStore.loadAll();

    const container = document.createElement('div');
    container.className = 'scoresheet-check-view';

    container.innerHTML = `
        <div class="view-header">
            <h1>Scoresheet Check</h1>
            <p class="view-description">Compare Scoresheet rosters with NPL rosters to find mismatches.</p>
            <div class="ss-info" style="margin-bottom: var(--spacing-md);"></div>
        </div>

        <div class="view-tabs" style="display: flex; gap: var(--spacing-sm); margin-bottom: var(--spacing-md);">
            <button class="btn btn-primary tab-btn" data-tab="mismatches">Mismatches</button>
            <button class="btn btn-secondary tab-btn" data-tab="summary">Team Summary</button>
        </div>

        <div class="filters-bar" style="display: flex; gap: var(--spacing-md); flex-wrap: wrap; align-items: flex-end; margin-bottom: var(--spacing-md);">
            <div id="ss-search"></div>
            <div id="ss-team-filter"></div>
            <div id="ss-status-filter"></div>
            <button class="btn btn-secondary" id="ss-export-btn">Export CSV</button>
        </div>

        <div id="ss-tab-content"></div>

        <div id="ss-loading" style="text-align: center; padding: var(--spacing-xxl);">
            <div class="spinner"></div>
            <p>Loading Scoresheet data...</p>
        </div>

        <div id="ss-error" style="display: none; text-align: center; padding: var(--spacing-xxl);">
            <p style="color: var(--color-error); font-weight: 600;">Could not load Scoresheet data.</p>
            <p style="color: var(--color-text-light);">
                Run <code>node scripts/fetch-scoresheet.js</code> from the npl-web directory,<br>
                or open <code>fetch-scoresheet.html</code> in your browser.
            </p>
        </div>
    `;

    // State
    let currentTab = 'mismatches';
    let comparison = null;
    let mismatchTable = null;
    let summaryTable = null;

    // Components
    const searchBox = createSearchBox({
        placeholder: 'Search player...',
        onSearch: () => applyFilters(),
    });
    container.querySelector('#ss-search').appendChild(searchBox);

    const teamFilter = createFilterSelect({
        label: 'SS Team',
        options: [{ value: '', label: 'All Teams' }],
        onChange: () => applyFilters(),
    });
    container.querySelector('#ss-team-filter').appendChild(teamFilter);

    const statusFilter = createFilterSelect({
        label: 'Status',
        options: [
            { value: '', label: 'All' },
            { value: 'Not on NPL', label: 'Not on NPL' },
            { value: 'Not on SS', label: 'Not on Scoresheet' },
        ],
        onChange: () => applyFilters(),
    });
    container.querySelector('#ss-status-filter').appendChild(statusFilter);

    // Tab switching
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.tab-btn').forEach(b => {
                b.classList.remove('btn-primary');
                b.classList.add('btn-secondary');
            });
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
            currentTab = btn.dataset.tab;
            renderTab();
        });
    });

    // Export
    container.querySelector('#ss-export-btn').addEventListener('click', () => {
        if (!comparison) return;
        const allMismatches = [...comparison.missingFromNPL, ...comparison.missingFromSS];
        downloadCSV(allMismatches, 'scoresheet_mismatches', ['name', 'position', 'mlbam', 'ssTeam', 'nplTeam', 'status']);
    });

    // Mismatch table columns
    const mismatchColumns = [
        column('name', 'Player', { sortable: true }),
        column('position', 'Pos', { type: 'position', sortable: true }),
        column('mlbam', 'MLBAM', { sortable: true, align: 'right' }),
        column('ssTeam', 'SS Team', { sortable: true }),
        column('nplTeam', 'NPL Team', { sortable: true }),
        column('status', 'Status', {
            sortable: true,
            render: (val) => {
                const cls = val === 'Not on NPL' ? 'badge-warning' : 'badge-info';
                return `<span class="badge ${cls}">${val}</span>`;
            },
        }),
    ];

    // Summary table columns
    const summaryColumns = [
        column('ssTeam', 'SS Team', { sortable: true }),
        column('ssCount', 'SS Roster', { type: 'number', sortable: true, align: 'right' }),
        column('nplTeam', 'NPL Team', { sortable: true }),
        column('nplCount', 'NPL Roster', { type: 'number', sortable: true, align: 'right' }),
        column('matchedCount', 'Matched', { type: 'number', sortable: true, align: 'right' }),
        column('unmatchedCount', 'Unmatched', {
            type: 'number',
            sortable: true,
            align: 'right',
            render: (val) => {
                if (val > 0) return `<span style="color: var(--color-error); font-weight: 600;">${val}</span>`;
                return `<span style="color: var(--color-success);">0</span>`;
            },
        }),
    ];

    function renderTab() {
        const content = container.querySelector('#ss-tab-content');
        content.innerHTML = '';

        if (!comparison) return;

        if (currentTab === 'mismatches') {
            if (!mismatchTable) {
                mismatchTable = createDataTable({
                    data: getAllMismatches(),
                    columns: mismatchColumns,
                    emptyMessage: 'No mismatches found — rosters are in sync!',
                    initialSort: 'ssTeam',
                    pageSize: 50,
                });
            }
            content.appendChild(mismatchTable);
        } else {
            if (!summaryTable) {
                summaryTable = createDataTable({
                    data: comparison.summary,
                    columns: summaryColumns,
                    emptyMessage: 'No team data available',
                    initialSort: 'ssTeam',
                    pageSize: 30,
                });
            }
            content.appendChild(summaryTable);
        }
    }

    function getAllMismatches() {
        if (!comparison) return [];
        return [...comparison.missingFromNPL, ...comparison.missingFromSS];
    }

    function applyFilters() {
        if (!comparison || !mismatchTable) return;

        let data = getAllMismatches();

        const search = searchBox.getValue();
        if (search) {
            data = filterBySearch(data, search, ['name', 'ssTeam', 'nplTeam']);
        }

        const team = teamFilter.getValue();
        if (team) {
            data = data.filter(d => d.ssTeam === team || d.nplTeam === team);
        }

        const status = statusFilter.getValue();
        if (status) {
            data = data.filter(d => d.status === status);
        }

        mismatchTable.updateData(data);
    }

    // Load data
    try {
        const ssData = await loadScoresheetData();

        // Update info bar
        const infoEl = container.querySelector('.ss-info');
        const fetchedDate = ssData.fetchedAt ? new Date(ssData.fetchedAt).toLocaleDateString() : 'Unknown';
        infoEl.innerHTML = `
            <span class="badge">Year: ${ssData.year}</span>
            <span class="badge" style="margin-left: var(--spacing-xs);">Round: ${ssData.round || '—'}</span>
            <span class="badge" style="margin-left: var(--spacing-xs);">Fetched: ${fetchedDate}</span>
        `;

        // Update team filter options
        const teamOptions = [
            { value: '', label: 'All Teams' },
            ...ssData.teams.map(t => ({ value: t, label: t })),
        ];
        const teamFilterEl = container.querySelector('#ss-team-filter');
        teamFilterEl.innerHTML = '';
        const newTeamFilter = createFilterSelect({
            label: 'SS Team',
            options: teamOptions,
            onChange: () => applyFilters(),
        });
        teamFilterEl.appendChild(newTeamFilter);
        // Reassign getValue for filters
        teamFilter.getValue = newTeamFilter.getValue;

        // Run comparison
        comparison = compareScoresheetWithNPL(ssData, dataStore.players);

        const totalMismatches = comparison.missingFromNPL.length + comparison.missingFromSS.length;
        console.log(`Scoresheet check: ${comparison.matched.length} matched, ${totalMismatches} mismatches`);

        // Hide loading, show content
        container.querySelector('#ss-loading').style.display = 'none';
        container.querySelector('.filters-bar').style.display = 'flex';
        container.querySelector('.view-tabs').style.display = 'flex';

        renderTab();

        if (totalMismatches === 0) {
            showToast('All rosters are in sync!', 'success');
        } else {
            showToast(`Found ${totalMismatches} roster mismatches`, 'info');
        }
    } catch (error) {
        console.error('Scoresheet check error:', error);
        container.querySelector('#ss-loading').style.display = 'none';
        container.querySelector('#ss-error').style.display = 'block';
        container.querySelector('.filters-bar').style.display = 'none';
        container.querySelector('.view-tabs').style.display = 'none';
    }

    return container;
}
