/**
 * Rosters View - Team Rosters
 */

import { dataStore, NPL_TEAMS } from '../api/sheets.js';
import { router } from '../router.js';
import { createDataTable, column } from '../components/dataTable.js';
import { createPositionFilter } from '../components/searchBox.js';
import { filterByPosition, calculateRosterStats, sortBy } from '../utils/dataTransform.js';
import { downloadCSV } from '../utils/csvParser.js';
import { fetchPlayerStats, fetchPlayerInfo, fetchSpringTrainingStats, isSpringTraining, formatStatsHTML, fetchMultiplePlayerInfo } from '../api/mlbStats.js';
import { fetchAllProjections, formatProjectionHTML } from '../api/fangraphs.js';

// Cache for player info by team
const teamPlayerInfoCache = {};

/**
 * Render the rosters view
 * @param {Object} params - Route parameters
 * @returns {HTMLElement} View element
 */
export async function renderRosters(params = {}) {
    // Ensure data is loaded
    if (!dataStore.isLoaded) {
        await dataStore.loadAll();
    }

    const container = document.createElement('div');
    container.className = 'rosters-view';

    // Get initial team from params or default to Bulldog
    const bulldogTeam = NPL_TEAMS.find(t => t.name === 'Bulldog');
    const initialTeamId = params.team || (bulldogTeam ? bulldogTeam.id : NPL_TEAMS[0].id);
    let currentTeamId = initialTeamId;
    let currentPosition = 'ALL';

    // State
    let currentRoster = [];
    let dataTable = null;
    let loadingTeamId = null; // Track which team we're loading

    /**
     * Enrich roster with player info from MLB API and projections
     */
    async function enrichRosterWithPlayerInfo(roster) {
        // Get valid MLB IDs (filter out empty strings, null, undefined)
        const mlbIds = roster
            .filter(p => p.mlbId && p.mlbId !== '' && p.mlbId !== 'undefined' && p.mlbId !== 'null')
            .map(p => String(p.mlbId).trim())
            .filter(id => id.length > 0 && /^\d+$/.test(id)); // Only numeric IDs

        if (mlbIds.length === 0) return roster;

        // Check cache first
        const cacheKey = currentTeamId;
        if (teamPlayerInfoCache[cacheKey]) {
            return mergePlayerData(roster, teamPlayerInfoCache[cacheKey].infoMap, teamPlayerInfoCache[cacheKey].projectionsMap);
        }

        // Fetch player info and projections in parallel
        const [infoMap, projectionsMap] = await Promise.all([
            fetchMultiplePlayerInfo(mlbIds),
            fetchAllProjections(),
        ]);

        // Cache the results
        teamPlayerInfoCache[cacheKey] = { infoMap, projectionsMap };

        return mergePlayerData(roster, infoMap, projectionsMap);
    }

    /**
     * Calculate total projected WAR for a roster
     */
    function calculateTotalWAR(roster) {
        const total = roster.reduce((sum, player) => {
            if (player.projectedWAR != null && !isNaN(player.projectedWAR)) {
                return sum + player.projectedWAR;
            }
            return sum;
        }, 0);
        return total;
    }

    /**
     * Merge player info and projections into roster
     */
    function mergePlayerData(roster, infoMap, projectionsMap) {
        return roster.map(player => {
            const info = infoMap[player.mlbId];
            const projection = projectionsMap[player.mlbId];

            return {
                ...player,
                age: info?.currentAge || player.age,
                bats: info?.batSide || player.bats,
                throws: info?.pitchHand || player.throws,
                projectedWAR: projection?.war ?? null,
                projection: projection || null,
            };
        });
    }

    /**
     * Update roster display
     */
    async function updateRoster() {
        const team = NPL_TEAMS.find(t => String(t.id) === String(currentTeamId));
        let roster = dataStore.getTeamRoster(currentTeamId);

        // Show initial data immediately
        currentRoster = filterByPosition(roster, currentPosition);
        currentRoster = sortBy(currentRoster, 'position', 'asc');

        // Update team info (initially without avg age if not loaded)
        const teamInfoEl = container.querySelector('.team-info');
        if (teamInfoEl && team) {
            teamInfoEl.innerHTML = `
                <h2>${team.name}</h2>
                <div class="flex gap-lg text-sm text-muted">
                    <span>${roster.length} Players</span>
                    <span id="roster-loading-status" class="text-muted">Loading player info...</span>
                </div>
            `;
        }

        // Update table with initial data
        if (dataTable) {
            dataTable.updateData(currentRoster);
        }

        // Fetch and enrich with MLB API data (with timeout)
        const teamIdToLoad = currentTeamId;
        if (loadingTeamId !== teamIdToLoad) {
            loadingTeamId = teamIdToLoad;
            try {
                // Add a 15-second timeout for the entire enrichment process
                const enrichmentTimeout = 15000;
                const enrichPromise = enrichRosterWithPlayerInfo(roster);
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Enrichment timeout')), enrichmentTimeout)
                );

                roster = await Promise.race([enrichPromise, timeoutPromise]);

                // Only update if we're still on the same team
                if (currentTeamId === teamIdToLoad) {
                    currentRoster = filterByPosition(roster, currentPosition);
                    currentRoster = sortBy(currentRoster, 'position', 'asc');

                    // Update table with enriched data
                    if (dataTable) {
                        dataTable.updateData(currentRoster);
                    }

                    // Update team info with stats
                    const stats = calculateRosterStats(currentRoster);
                    const totalWAR = calculateTotalWAR(currentRoster);
                    if (teamInfoEl && team) {
                        teamInfoEl.innerHTML = `
                            <h2>${team.name}</h2>
                            <div class="flex gap-lg text-sm text-muted">
                                <span>${stats.total} Players</span>
                                <span>${stats.pitchers} Pitchers</span>
                                <span>${stats.hitters} Hitters</span>
                                ${stats.avgAge ? `<span>Avg Age: ${stats.avgAge}</span>` : ''}
                                <span>Proj. WAR: <strong>${totalWAR.toFixed(1)}</strong></span>
                            </div>
                        `;
                    }
                }
            } catch (error) {
                // Don't log timeout errors as they're expected
                if (error.message !== 'Enrichment timeout') {
                    console.error('Error enriching roster:', error);
                }
                // Remove loading indicator on error/timeout
                if (currentTeamId === teamIdToLoad) {
                    const loadingEl = container.querySelector('#roster-loading-status');
                    if (loadingEl) {
                        loadingEl.textContent = error.message === 'Enrichment timeout' ? '(Player info loading timed out)' : '';
                    }
                    // Still show roster stats without player info
                    const stats = calculateRosterStats(currentRoster);
                    const totalWAR = calculateTotalWAR(currentRoster);
                    const teamInfoEl = container.querySelector('.team-info');
                    const team = NPL_TEAMS.find(t => String(t.id) === String(currentTeamId));
                    if (teamInfoEl && team) {
                        teamInfoEl.innerHTML = `
                            <h2>${team.name}</h2>
                            <div class="flex gap-lg text-sm text-muted">
                                <span>${stats.total} Players</span>
                                <span>${stats.pitchers} Pitchers</span>
                                <span>${stats.hitters} Hitters</span>
                                ${totalWAR > 0 ? `<span>Proj. WAR: <strong>${totalWAR.toFixed(1)}</strong></span>` : ''}
                            </div>
                        `;
                    }
                }
            } finally {
                if (loadingTeamId === teamIdToLoad) {
                    loadingTeamId = null;
                }
            }
        }
    }

    // Build view HTML
    container.innerHTML = `
        <div class="view-header">
            <h1>Team Rosters</h1>
            <p>View and manage NPL team rosters</p>
        </div>

        <div class="filters-bar">
            <div class="filter-group">
                <label>NPL Team</label>
                <select id="team-select" class="filter-select">
                    ${NPL_TEAMS.map(team => `
                        <option value="${team.id}" ${String(team.id) === String(initialTeamId) ? 'selected' : ''}>
                            ${team.name}
                        </option>
                    `).join('')}
                </select>
            </div>
            <div id="position-filter-container"></div>
            <div class="filter-group" style="margin-left: auto;">
                <button id="export-btn" class="btn btn-secondary">
                    Export CSV
                </button>
            </div>
        </div>

        <div class="team-info mb-md"></div>

        <div id="roster-table-container"></div>
    `;

    // Add position filter
    const positionFilterContainer = container.querySelector('#position-filter-container');
    const positionFilter = createPositionFilter({
        onChange: (position) => {
            currentPosition = position;
            updateRoster();
        },
    });
    positionFilterContainer.appendChild(positionFilter);

    // Create data table
    const tableContainer = container.querySelector('#roster-table-container');
    dataTable = createDataTable({
        data: [],
        columns: [
            column('name', 'Player', {
                sortable: true,
                render: (value, row) => {
                    const headshotUrl = getHeadshotUrl(row.mlbId, 'small');
                    const imgHtml = headshotUrl
                        ? `<img src="${headshotUrl}" class="player-headshot-sm" alt="" loading="lazy">`
                        : '';
                    return `<div class="player-name-cell">${imgHtml}<span>${value}</span></div>`;
                }
            }),
            column('position', 'Pos', { type: 'position', sortable: true }),
            column('mlbTeam', 'MLB Team', { sortable: true }),
            column('age', 'Age', { type: 'number', sortable: true, align: 'right' }),
            column('bats', 'Bats', { sortable: true, align: 'center' }),
            column('throws', 'Throws', { sortable: true, align: 'center' }),
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
        ],
        title: 'Roster',
        pageSize: 200,
        clickable: true,
        onRowClick: (player) => {
            showPlayerModal(player);
        },
        emptyMessage: 'No players on this roster',
    });
    tableContainer.appendChild(dataTable);

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
    function getHeadshotUrl(mlbId, size = 'small') {
        if (!mlbId) return null;
        // Use MLB static CDN - reliable headshot source
        const spotSize = size === 'small' ? '60' : '120';
        return `https://midfield.mlbstatic.com/v1/people/${mlbId}/spots/${spotSize}`;
    }

    // Team selector
    const teamSelect = container.querySelector('#team-select');
    teamSelect.addEventListener('change', (e) => {
        currentTeamId = e.target.value;
        // Update URL without triggering full re-render
        history.replaceState(null, '', `#/rosters?team=${currentTeamId}`);
        updateRoster();
    });

    // Export button
    const exportBtn = container.querySelector('#export-btn');
    exportBtn.addEventListener('click', () => {
        const team = NPL_TEAMS.find(t => String(t.id) === String(currentTeamId));
        const filename = `npl_roster_${team ? team.name.toLowerCase() : 'export'}`;
        downloadCSV(currentRoster, filename, ['name', 'position', 'mlbTeam', 'age', 'bats', 'throws', 'projectedWAR']);
    });

    // Initial load
    updateRoster();

    return container;
}

/**
 * Get MLB headshot URL for a player (module-level for modal use)
 */
function getPlayerHeadshotUrl(mlbId, size = 'small') {
    if (!mlbId) return null;
    // Use MLB static CDN - reliable headshot source
    const spotSize = size === 'small' ? '60' : '120';
    return `https://midfield.mlbstatic.com/v1/people/${mlbId}/spots/${spotSize}`;
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
    const headshotUrl = getPlayerHeadshotUrl(player.mlbId, 'medium');

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
                        ${player.nplTeam ? `<span class="player-meta-item badge badge-primary">${player.nplTeam}</span>` : ''}
                    </div>
                </div>
            </div>

            <div id="player-stats-container">
                <div class="flex items-center gap-sm text-muted p-md">
                    <div class="spinner" style="width: 20px; height: 20px;"></div>
                    <span>Loading stats...</span>
                </div>
            </div>

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
            const inSpringTraining = isSpringTraining();
            if (inSpringTraining) {
                fetches.push(fetchSpringTrainingStats(player.mlbId));
            }

            const [stats, info, springStats] = await Promise.all(fetches);

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
                const projectionHTML = player.projection ? formatProjectionHTML(player.projection) : '';

                statsContainer.innerHTML = infoHTML + projectionHTML + statsHTML;
            }
        } catch (error) {
            console.error('Error fetching player stats:', error);
            const statsContainer = document.getElementById('player-stats-container');
            if (statsContainer) {
                statsContainer.innerHTML = '<p class="text-muted p-md">Unable to load stats</p>';
            }
        }
    }
}

// Global function to close modal
window.closeModal = function() {
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.add('hidden');
    }
};

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
        window.closeModal();
    }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.closeModal();
    }
});
