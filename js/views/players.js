/**
 * Players View - Player Search
 */

import { dataStore, NPL_TEAMS, MLB_TEAMS } from '../api/sheets.js';
import { createDataTable, column } from '../components/dataTable.js';
import { createSearchBox, createPositionFilter, createFilterSelect } from '../components/searchBox.js';
import { sortBy } from '../utils/dataTransform.js';
import { downloadCSV } from '../utils/csvParser.js';
import { fetchPlayerStats, fetchPlayerInfo, fetchSpringTrainingStats, isSpringTraining, formatStatsHTML } from '../api/mlbStats.js';
import { fetchAllProjections, formatProjectionHTML } from '../api/fangraphs.js';

// Cache for projections
let projectionsMap = null;

/**
 * Render the players view
 * @param {Object} params - Route parameters
 * @returns {HTMLElement} View element
 */
export async function renderPlayers(params = {}) {
    // Ensure data is loaded
    if (!dataStore.isLoaded) {
        await dataStore.loadAll();
    }

    const container = document.createElement('div');
    container.className = 'players-view';

    // State
    let filters = {
        search: params.q || '',
        position: params.pos || 'ALL',
        nplTeamId: params.team || '',
        rostered: params.rostered || '',
    };
    let currentResults = [];
    let dataTable = null;

    /**
     * Enrich players with projection data
     */
    function enrichWithProjections(players) {
        if (!projectionsMap) return players;

        return players.map(player => {
            const projection = projectionsMap[player.mlbId];
            if (projection) {
                return {
                    ...player,
                    projectedWAR: projection.war,
                    projection: projection,
                };
            }
            return player;
        });
    }

    /**
     * Apply filters and update results
     */
    function applyFilters() {
        let results = dataStore.searchPlayers(filters.search, {
            position: filters.position,
            nplTeamId: filters.nplTeamId,
            rostered: filters.rostered === 'rostered' ? true :
                      filters.rostered === 'free' ? false : undefined,
        });

        // Enrich with projections
        results = enrichWithProjections(results);

        // Sort by name by default
        currentResults = sortBy(results, 'name', 'asc');

        // Update table
        if (dataTable) {
            dataTable.updateData(currentResults);
        }

        // Update result count
        const countEl = container.querySelector('.result-count');
        if (countEl) {
            countEl.textContent = `${currentResults.length} players found`;
        }
    }

    /**
     * Get CSS class based on WAR value
     */
    function getWARClass(war) {
        if (war >= 5) return 'war-elite';
        if (war >= 3) return 'war-great';
        if (war >= 2) return 'war-good';
        if (war >= 1) return 'war-average';
        if (war >= 0) return 'war-below';
        return 'war-negative';
    }

    /**
     * Get MLB headshot URL for a player
     */
    function getHeadshotUrl(mlbId) {
        if (!mlbId) return null;
        return `https://midfield.mlbstatic.com/v1/people/${mlbId}/spots/60`;
    }

    // Build view HTML
    container.innerHTML = `
        <div class="view-header">
            <h1>Player Search</h1>
            <p>Search and filter all NPL players</p>
        </div>

        <div class="filters-bar">
            <div class="filter-group flex-grow" id="search-container"></div>
            <div id="position-filter-container"></div>
            <div class="filter-group">
                <label>NPL Team</label>
                <select id="npl-team-filter" class="filter-select">
                    <option value="">All Teams</option>
                    ${NPL_TEAMS.map(team => `
                        <option value="${team.id}" ${String(team.id) === filters.nplTeamId ? 'selected' : ''}>
                            ${team.name}
                        </option>
                    `).join('')}
                </select>
            </div>
            <div class="filter-group">
                <label>Status</label>
                <select id="rostered-filter" class="filter-select">
                    <option value="">All</option>
                    <option value="rostered" ${filters.rostered === 'rostered' ? 'selected' : ''}>Rostered</option>
                    <option value="free" ${filters.rostered === 'free' ? 'selected' : ''}>Free Agents</option>
                </select>
            </div>
            <div class="filter-group" style="margin-left: auto;">
                <button id="export-btn" class="btn btn-secondary">Export</button>
            </div>
        </div>

        <div class="flex justify-between items-center mb-md">
            <span class="result-count text-muted text-sm">${dataStore.players.length} players found</span>
        </div>

        <div id="players-table-container"></div>
    `;

    // Add search box
    const searchContainer = container.querySelector('#search-container');
    const searchBox = createSearchBox({
        placeholder: 'Search by name, team...',
        initialValue: filters.search,
        onSearch: (value) => {
            filters.search = value;
            applyFilters();
        },
    });
    searchContainer.appendChild(searchBox);

    // Add position filter
    const positionFilterContainer = container.querySelector('#position-filter-container');
    const positionFilter = createPositionFilter({
        initialValue: filters.position,
        onChange: (position) => {
            filters.position = position;
            applyFilters();
        },
    });
    positionFilterContainer.appendChild(positionFilter);

    // NPL team filter
    const nplTeamFilter = container.querySelector('#npl-team-filter');
    nplTeamFilter.addEventListener('change', (e) => {
        filters.nplTeamId = e.target.value;
        applyFilters();
    });

    // Rostered filter
    const rosteredFilter = container.querySelector('#rostered-filter');
    rosteredFilter.addEventListener('change', (e) => {
        filters.rostered = e.target.value;
        applyFilters();
    });

    // Create data table
    const tableContainer = container.querySelector('#players-table-container');
    dataTable = createDataTable({
        data: [],
        columns: [
            column('name', 'Player', {
                sortable: true,
                render: (value, row) => {
                    const headshotUrl = getHeadshotUrl(row.mlbId);
                    const imgHtml = headshotUrl
                        ? `<img src="${headshotUrl}" class="player-headshot-sm" alt="" loading="lazy">`
                        : '';
                    return `<div class="player-name-cell">${imgHtml}<span>${value}</span></div>`;
                }
            }),
            column('position', 'Pos', { type: 'position', sortable: true }),
            column('mlbTeam', 'MLB', { sortable: true }),
            column('nplTeam', 'NPL Team', {
                sortable: true,
                render: (value, row) => {
                    if (!row.isRostered) {
                        return '<span class="text-muted">Free Agent</span>';
                    }
                    return value || '';
                }
            }),
            column('projectedWAR', '2026 WAR', {
                type: 'number',
                sortable: true,
                align: 'right',
                render: (value) => {
                    if (value === null || value === undefined) return '-';
                    const warClass = getWARClass(value);
                    return `<span class="${warClass}">${value.toFixed(1)}</span>`;
                }
            }),
            column('age', 'Age', { type: 'number', sortable: true, align: 'right' }),
        ],
        title: '',
        showCount: false,
        pageSize: 50,
        clickable: true,
        onRowClick: (player) => {
            showPlayerModal(player);
        },
        emptyMessage: 'No players found matching your criteria',
        initialSort: 'name',
    });
    tableContainer.appendChild(dataTable);

    // Export button
    const exportBtn = container.querySelector('#export-btn');
    exportBtn.addEventListener('click', () => {
        const filename = 'npl_players_search';
        downloadCSV(currentResults, filename, ['name', 'position', 'mlbTeam', 'nplTeam', 'projectedWAR', 'age']);
    });

    // Initial filter application
    applyFilters();

    // Load projections in background
    if (!projectionsMap) {
        fetchAllProjections().then(projections => {
            projectionsMap = projections;
            // Re-apply filters to update with projections
            applyFilters();
        }).catch(error => {
            console.error('Error loading projections:', error);
        });
    }

    return container;
}

/**
 * Get MLB headshot URL for modal (larger size)
 */
function getModalHeadshotUrl(mlbId) {
    if (!mlbId) return null;
    return `https://midfield.mlbstatic.com/v1/people/${mlbId}/spots/120`;
}

/**
 * Show player detail modal with MLB stats
 * @param {Object} player - Player object
 */
async function showPlayerModal(player) {
    const modalOverlay = document.getElementById('modal-overlay');
    const modalBody = document.getElementById('modal-body');

    if (!modalOverlay || !modalBody) return;

    // Get initials for avatar fallback
    const initials = player.name
        .split(' ')
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();

    // Get headshot URL
    const headshotUrl = getModalHeadshotUrl(player.mlbId);

    // Show modal immediately with loading state for stats
    modalBody.innerHTML = `
        <div class="player-card">
            <div class="player-card-header">
                ${headshotUrl ? `
                    <img src="${headshotUrl}" class="player-headshot-lg" alt="${player.name}">
                ` : `
                    <div class="player-avatar">${initials}</div>
                `}
                <div class="player-info">
                    <h2 class="player-name">${player.name}</h2>
                    <div class="player-meta">
                        <span class="player-meta-item">
                            <span class="position-badge position-${player.position}">${player.position}</span>
                        </span>
                        ${player.mlbTeam ? `<span class="player-meta-item">${player.mlbTeam}</span>` : ''}
                        ${player.nplTeam && player.isRostered ? `
                            <span class="player-meta-item badge badge-primary">${player.nplTeam}</span>
                        ` : `
                            <span class="player-meta-item badge">Free Agent</span>
                        `}
                    </div>
                </div>
            </div>

            <div id="player-stats-container">
                <div class="flex items-center gap-sm text-muted p-md">
                    <div class="spinner" style="width: 20px; height: 20px;"></div>
                    <span>Loading stats...</span>
                </div>
            </div>

            ${player.scoutingReport ? `
                <div class="player-scouting">
                    <h4>Scouting Report</h4>
                    <div class="player-scouting-report">${player.scoutingReport}</div>
                </div>
            ` : ''}

            <div class="flex gap-sm mt-lg">
                ${player.mlbId ? `
                    <a href="https://www.mlb.com/player/${player.mlbId}" target="_blank" class="btn btn-secondary">
                        MLB Profile
                    </a>
                ` : ''}
                <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            </div>
        </div>
    `;

    modalOverlay.classList.remove('hidden');

    // Fetch stats in background
    if (player.mlbId) {
        try {
            const fetches = [
                fetchPlayerStats(player.mlbId),
                fetchPlayerInfo(player.mlbId),
            ];
            // Fetch spring training stats in parallel when in ST period
            const inSpringTraining = isSpringTraining();
            if (inSpringTraining) {
                fetches.push(fetchSpringTrainingStats(player.mlbId));
            }

            const [stats, info, springStats] = await Promise.all(fetches);

            // Attach spring training stats to the stats object for formatStatsHTML
            if (stats && springStats) {
                stats.springTraining = springStats;
            }

            const statsContainer = document.getElementById('player-stats-container');
            if (statsContainer) {
                // Build player info section
                let infoHTML = '';
                if (info) {
                    infoHTML = `
                        <div class="player-stats-grid mb-md">
                            ${info.currentAge ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">${info.currentAge}</div>
                                    <div class="player-stat-label">Age</div>
                                </div>
                            ` : ''}
                            ${info.batSide ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">${info.batSide}</div>
                                    <div class="player-stat-label">Bats</div>
                                </div>
                            ` : ''}
                            ${info.pitchHand ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">${info.pitchHand}</div>
                                    <div class="player-stat-label">Throws</div>
                                </div>
                            ` : ''}
                            ${info.height ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">${info.height}</div>
                                    <div class="player-stat-label">Height</div>
                                </div>
                            ` : ''}
                            ${info.weight ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">${info.weight}</div>
                                    <div class="player-stat-label">Weight</div>
                                </div>
                            ` : ''}
                            ${info.mlbDebutDate ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">${info.mlbDebutDate.substring(0, 4)}</div>
                                    <div class="player-stat-label">MLB Debut</div>
                                </div>
                            ` : ''}
                            ${player.fv ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">${player.fv}</div>
                                    <div class="player-stat-label">FV</div>
                                </div>
                            ` : ''}
                            ${player.rank ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">#${player.rank}</div>
                                    <div class="player-stat-label">Rank</div>
                                </div>
                            ` : ''}
                            ${info.rosterStatus ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">
                                        <span class="roster-status roster-status-${info.rosterStatus.statusCode?.toLowerCase() || ''}">${info.rosterStatus.statusDescription}</span>
                                    </div>
                                    <div class="player-stat-label">Roster Status</div>
                                </div>
                            ` : ''}
                            ${info.rosterStatus?.team ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">${info.rosterStatus.team}</div>
                                    <div class="player-stat-label">Current Assignment</div>
                                </div>
                            ` : ''}
                            ${info.rosterStatus?.isOn40Man ? `
                                <div class="player-stat">
                                    <div class="player-stat-value">Yes</div>
                                    <div class="player-stat-label">40-Man</div>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }

                // Build stats section
                const statsHTML = formatStatsHTML(stats, player.position);

                // Build projections section
                const projection = player.projection || (projectionsMap && projectionsMap[player.mlbId]);
                const projectionHTML = projection ? formatProjectionHTML(projection) : '';

                statsContainer.innerHTML = infoHTML + projectionHTML + statsHTML;
            }
        } catch (error) {
            console.error('Error fetching player stats:', error);
            const statsContainer = document.getElementById('player-stats-container');
            if (statsContainer) {
                // Show basic info if API fails
                statsContainer.innerHTML = `
                    <div class="player-stats-grid">
                        ${player.age ? `
                            <div class="player-stat">
                                <div class="player-stat-value">${player.age}</div>
                                <div class="player-stat-label">Age</div>
                            </div>
                        ` : ''}
                        ${player.bats ? `
                            <div class="player-stat">
                                <div class="player-stat-value">${player.bats}</div>
                                <div class="player-stat-label">Bats</div>
                            </div>
                        ` : ''}
                        ${player.throws ? `
                            <div class="player-stat">
                                <div class="player-stat-value">${player.throws}</div>
                                <div class="player-stat-label">Throws</div>
                            </div>
                        ` : ''}
                        ${player.fv ? `
                            <div class="player-stat">
                                <div class="player-stat-value">${player.fv}</div>
                                <div class="player-stat-label">FV</div>
                            </div>
                        ` : ''}
                        ${player.rank ? `
                            <div class="player-stat">
                                <div class="player-stat-value">#${player.rank}</div>
                                <div class="player-stat-label">Rank</div>
                            </div>
                        ` : ''}
                    </div>
                    <p class="text-muted text-sm p-md">Unable to load MLB stats</p>
                `;
            }
        }
    } else {
        // No MLB ID - show basic player info
        const statsContainer = document.getElementById('player-stats-container');
        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="player-stats-grid">
                    ${player.age ? `
                        <div class="player-stat">
                            <div class="player-stat-value">${player.age}</div>
                            <div class="player-stat-label">Age</div>
                        </div>
                    ` : ''}
                    ${player.bats ? `
                        <div class="player-stat">
                            <div class="player-stat-value">${player.bats}</div>
                            <div class="player-stat-label">Bats</div>
                        </div>
                    ` : ''}
                    ${player.throws ? `
                        <div class="player-stat">
                            <div class="player-stat-value">${player.throws}</div>
                            <div class="player-stat-label">Throws</div>
                        </div>
                    ` : ''}
                    ${player.fv ? `
                        <div class="player-stat">
                            <div class="player-stat-value">${player.fv}</div>
                            <div class="player-stat-label">FV</div>
                        </div>
                    ` : ''}
                    ${player.eta ? `
                        <div class="player-stat">
                            <div class="player-stat-value">${player.eta}</div>
                            <div class="player-stat-label">ETA</div>
                        </div>
                    ` : ''}
                    ${player.rank ? `
                        <div class="player-stat">
                            <div class="player-stat-value">#${player.rank}</div>
                            <div class="player-stat-label">Rank</div>
                        </div>
                    ` : ''}
                </div>
            `;
        }
    }
}
