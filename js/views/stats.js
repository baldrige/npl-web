/**
 * Stats View - League-wide Statistics
 * Shows projected (Fangraphs) and actual (MLB API) stats for all NPL players
 */

import { dataStore, NPL_TEAMS } from '../api/sheets.js';
import { createDataTable, column } from '../components/dataTable.js';
import { createSearchBox, createPositionFilter } from '../components/searchBox.js';
import { sortBy } from '../utils/dataTransform.js';
import { fetchAllProjections } from '../api/fangraphs.js';
import { sessionCache } from '../api/cache.js';

const MLB_STATS_API = 'https://statsapi.mlb.com/api/v1';
const STATS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// In-memory caches
let projectionsMap = null;
let actualStatsCache = { hitters: null, pitchers: null, year: null };

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

// ─── Number formatting helpers ───

function fmtRate(val) {
    if (val == null || val === '' || isNaN(val)) return '-';
    const n = parseFloat(val);
    return n.toFixed(3).replace(/^0\./, '.');
}

function fmtERA(val) {
    if (val == null || val === '' || isNaN(val)) return '-';
    return parseFloat(val).toFixed(2);
}

function fmtWAR(val) {
    if (val == null || val === '' || isNaN(val)) return '-';
    return parseFloat(val).toFixed(1);
}

function fmtInt(val) {
    if (val == null || val === '' || isNaN(val)) return '-';
    return Math.round(parseFloat(val)).toString();
}

function fmtIP(val) {
    if (val == null || val === '' || isNaN(val)) return '-';
    return parseFloat(val).toFixed(1);
}

// ─── MLB API Fetch Helpers ───

/**
 * Fetch season stats in batches of up to 100 players
 */
async function fetchSeasonStatsBatch(mlbIds, year) {
    const cacheKey = `stats_season_batch_${year}_${mlbIds.sort().join(',')}`;
    const cached = sessionCache.get(cacheKey);
    if (cached) return cached;

    const results = {};
    const batchSize = 100;

    for (let i = 0; i < mlbIds.length; i += batchSize) {
        const batch = mlbIds.slice(i, i + batchSize);
        const idsParam = batch.join(',');
        const url = `${MLB_STATS_API}/people?personIds=${idsParam}&hydrate=stats(type=season,season=${year},gameType=R)`;

        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const data = await response.json();

            if (data.people) {
                for (const person of data.people) {
                    const id = String(person.id);
                    const statsGroups = person.stats || [];
                    const playerStats = { hitting: null, pitching: null };

                    for (const sg of statsGroups) {
                        const group = sg.group?.displayName?.toLowerCase();
                        const split = sg.splits?.[0];
                        if (split && split.stat) {
                            playerStats[group] = split.stat;
                        }
                    }

                    results[id] = playerStats;
                }
            }
        } catch (error) {
            console.error('Error fetching season stats batch:', error);
        }
    }

    sessionCache.set(cacheKey, results, STATS_CACHE_TTL);
    return results;
}

/**
 * Fetch expected statistics for a single player
 */
async function fetchExpectedStats(mlbId, year, group = 'hitting') {
    const cacheKey = `stats_expected_${mlbId}_${year}_${group}`;
    const cached = sessionCache.get(cacheKey);
    if (cached) return cached;

    try {
        const url = `${MLB_STATS_API}/people/${mlbId}/stats?stats=expectedStatistics&season=${year}&group=${group}`;
        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        const split = data.stats?.[0]?.splits?.[0]?.stat;
        if (split) {
            sessionCache.set(cacheKey, split, STATS_CACHE_TTL);
        }
        return split || null;
    } catch {
        return null;
    }
}

/**
 * Fetch sabermetrics for a single player
 */
async function fetchSabermetrics(mlbId, year, group = 'pitching') {
    const cacheKey = `stats_saber_${mlbId}_${year}_${group}`;
    const cached = sessionCache.get(cacheKey);
    if (cached) return cached;

    try {
        const url = `${MLB_STATS_API}/people/${mlbId}/stats?stats=sabermetrics&season=${year}&group=${group}`;
        const response = await fetch(url);
        if (!response.ok) return null;

        const data = await response.json();
        const split = data.stats?.[0]?.splits?.[0]?.stat;
        if (split) {
            sessionCache.set(cacheKey, split, STATS_CACHE_TTL);
        }
        return split || null;
    } catch {
        return null;
    }
}

/**
 * Fetch advanced stats in batches of 5 with 100ms delay
 * @param {Array} items - Array of { mlbId, ... }
 * @param {Function} fetchFn - async function(mlbId) => result
 * @param {Function} onBatchDone - callback after each batch completes with results array
 */
async function fetchInBatches(items, fetchFn, onBatchDone) {
    const batchSize = 5;
    const allResults = [];

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map(async (item) => {
                const result = await fetchFn(item.mlbId);
                return { mlbId: item.mlbId, data: result };
            })
        );

        allResults.push(...batchResults);
        if (onBatchDone) onBatchDone(allResults);

        // Delay between batches to avoid rate limiting
        if (i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return allResults;
}

// ─── Main Render Function ───

/**
 * Render the stats view
 * @param {Object} params - Route parameters
 * @returns {HTMLElement} View element
 */
export async function renderStats(params = {}) {
    if (!dataStore.isLoaded) {
        await dataStore.loadAll();
    }

    const container = document.createElement('div');
    container.className = 'stats-view';

    const currentYear = new Date().getFullYear();

    // State
    let mode = params.mode || 'projected'; // 'projected' or 'actual'
    let playerType = params.type || 'hitters'; // 'hitters' or 'pitchers'
    let filters = {
        search: params.q || '',
        position: params.pos || 'ALL',
        nplTeamId: params.team || '',
        rostered: params.rostered || 'rostered',
    };

    let dataTable = null;
    let currentData = [];
    let isLoadingActual = false;
    let actualHitters = [];
    let actualPitchers = [];

    // ─── Build HTML ───

    container.innerHTML = `
        <div class="view-header">
            <h1>Player Stats</h1>
            <p>View projected and actual statistics for NPL players</p>
        </div>

        <div class="filters-bar">
            <div class="filter-group">
                <label>Stats Mode</label>
                <div class="toggle-group" id="mode-toggle">
                    <button class="toggle-btn ${mode === 'projected' ? 'active' : ''}" data-value="projected">Projected</button>
                    <button class="toggle-btn ${mode === 'actual' ? 'active' : ''}" data-value="actual">Actual</button>
                </div>
            </div>
            <div class="filter-group">
                <label>Player Type</label>
                <div class="toggle-group" id="type-toggle">
                    <button class="toggle-btn ${playerType === 'hitters' ? 'active' : ''}" data-value="hitters">Hitters</button>
                    <button class="toggle-btn ${playerType === 'pitchers' ? 'active' : ''}" data-value="pitchers">Pitchers</button>
                </div>
            </div>
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
                    <option value="" ${filters.rostered === '' ? 'selected' : ''}>All</option>
                    <option value="rostered" ${filters.rostered === 'rostered' ? 'selected' : ''}>Rostered</option>
                    <option value="free" ${filters.rostered === 'free' ? 'selected' : ''}>Free Agents</option>
                </select>
            </div>
        </div>

        <div class="flex justify-between items-center mb-md">
            <span class="result-count text-muted text-sm"></span>
            <span id="stats-loading-indicator" class="text-muted text-sm hidden">
                <span class="spinner" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle;"></span>
                Loading stats...
            </span>
        </div>

        <div id="stats-table-container"></div>
    `;

    // ─── Attach Filter Components ───

    const searchContainer = container.querySelector('#search-container');
    const searchBox = createSearchBox({
        placeholder: 'Search by player name...',
        initialValue: filters.search,
        onSearch: (value) => {
            filters.search = value;
            applyFiltersAndRender();
        },
    });
    searchContainer.appendChild(searchBox);

    const positionFilterContainer = container.querySelector('#position-filter-container');
    const positionFilter = createPositionFilter({
        initialValue: filters.position,
        onChange: (position) => {
            filters.position = position;
            applyFiltersAndRender();
        },
    });
    positionFilterContainer.appendChild(positionFilter);

    container.querySelector('#npl-team-filter').addEventListener('change', (e) => {
        filters.nplTeamId = e.target.value;
        applyFiltersAndRender();
    });

    container.querySelector('#rostered-filter').addEventListener('change', (e) => {
        filters.rostered = e.target.value;
        applyFiltersAndRender();
    });

    // Mode toggle
    container.querySelector('#mode-toggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        mode = btn.dataset.value;
        container.querySelectorAll('#mode-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onModeOrTypeChange();
    });

    // Player type toggle
    container.querySelector('#type-toggle').addEventListener('click', (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn) return;
        playerType = btn.dataset.value;
        container.querySelectorAll('#type-toggle .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onModeOrTypeChange();
    });

    // ─── Column Definitions ───

    function getProjectedHitterColumns() {
        return [
            column('name', 'Name', { sortable: true, render: (v) => v || '-' }),
            column('mlbTeam', 'Team', { sortable: true }),
            column('nplTeam', 'NPL Team', {
                sortable: true,
                render: (v, row) => row.isRostered ? (v || '') : '<span class="text-muted">FA</span>',
            }),
            column('pa', 'PA', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('hr', 'HR', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('rbi', 'RBI', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('sb', 'SB', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('avg', 'AVG', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('obp', 'OBP', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('slg', 'SLG', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('ops', 'OPS', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('wOBA', 'wOBA', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('wRCPlus', 'wRC+', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('war', 'WAR', {
                sortable: true, align: 'right',
                render: (v) => {
                    if (v == null || v === '') return '-';
                    const cls = getWARClass(parseFloat(v));
                    return `<span class="${cls}">${fmtWAR(v)}</span>`;
                },
            }),
        ];
    }

    function getProjectedPitcherColumns() {
        return [
            column('name', 'Name', { sortable: true, render: (v) => v || '-' }),
            column('mlbTeam', 'Team', { sortable: true }),
            column('nplTeam', 'NPL Team', {
                sortable: true,
                render: (v, row) => row.isRostered ? (v || '') : '<span class="text-muted">FA</span>',
            }),
            column('ip', 'IP', { sortable: true, align: 'right', render: (v) => fmtIP(v) }),
            column('w', 'W', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('l', 'L', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('era', 'ERA', { sortable: true, align: 'right', render: (v) => fmtERA(v) }),
            column('whip', 'WHIP', { sortable: true, align: 'right', render: (v) => fmtERA(v) }),
            column('so', 'K', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('fip', 'FIP', { sortable: true, align: 'right', render: (v) => fmtERA(v) }),
            column('sv', 'SV', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('war', 'WAR', {
                sortable: true, align: 'right',
                render: (v) => {
                    if (v == null || v === '') return '-';
                    const cls = getWARClass(parseFloat(v));
                    return `<span class="${cls}">${fmtWAR(v)}</span>`;
                },
            }),
        ];
    }

    function getActualHitterColumns() {
        return [
            column('name', 'Name', { sortable: true, render: (v) => v || '-' }),
            column('mlbTeam', 'Team', { sortable: true }),
            column('nplTeam', 'NPL Team', {
                sortable: true,
                render: (v, row) => row.isRostered ? (v || '') : '<span class="text-muted">FA</span>',
            }),
            column('gamesPlayed', 'G', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('atBats', 'AB', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('hits', 'H', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('homeRuns', 'HR', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('rbi', 'RBI', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('stolenBases', 'SB', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('avg', 'AVG', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('obp', 'OBP', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('slg', 'SLG', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('ops', 'OPS', { sortable: true, align: 'right', render: (v) => fmtRate(v) }),
            column('xwOBA', 'xwOBA', { sortable: true, align: 'right', render: (v) => v === '--' ? '--' : fmtRate(v) }),
        ];
    }

    function getActualPitcherColumns() {
        return [
            column('name', 'Name', { sortable: true, render: (v) => v || '-' }),
            column('mlbTeam', 'Team', { sortable: true }),
            column('nplTeam', 'NPL Team', {
                sortable: true,
                render: (v, row) => row.isRostered ? (v || '') : '<span class="text-muted">FA</span>',
            }),
            column('gamesPlayed', 'G', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('gamesStarted', 'GS', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('wins', 'W', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('losses', 'L', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('era', 'ERA', { sortable: true, align: 'right', render: (v) => fmtERA(v) }),
            column('inningsPitched', 'IP', { sortable: true, align: 'right', render: (v) => v != null && v !== '' ? v : '-' }),
            column('strikeOuts', 'K', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('baseOnBalls', 'BB', { sortable: true, align: 'right', render: (v) => fmtInt(v) }),
            column('whip', 'WHIP', { sortable: true, align: 'right', render: (v) => fmtERA(v) }),
            column('xFIP', 'xFIP', { sortable: true, align: 'right', render: (v) => v === '--' ? '--' : fmtERA(v) }),
        ];
    }

    // ─── Data Builders ───

    function getFilteredPlayers() {
        let results = dataStore.searchPlayers(filters.search, {
            position: filters.position,
            nplTeamId: filters.nplTeamId,
            rostered: filters.rostered === 'rostered' ? true :
                      filters.rostered === 'free' ? false : undefined,
        });
        return results;
    }

    /**
     * Build projected stats rows
     */
    function buildProjectedData() {
        if (!projectionsMap) return [];

        const players = getFilteredPlayers();
        const rows = [];

        for (const player of players) {
            const proj = projectionsMap[player.mlbId];
            if (!proj) continue;

            const isPitcher = proj.isPitcher === true;
            if (playerType === 'hitters' && isPitcher) continue;
            if (playerType === 'pitchers' && !isPitcher) continue;

            rows.push({
                mlbId: player.mlbId,
                name: player.name,
                mlbTeam: proj.team || player.mlbTeam || '',
                nplTeam: player.nplTeam || '',
                isRostered: player.isRostered,
                // Hitter fields
                pa: proj.pa,
                hr: proj.hr,
                rbi: proj.rbi,
                sb: proj.sb,
                avg: proj.avg,
                obp: proj.obp,
                slg: proj.slg,
                ops: proj.ops,
                wOBA: proj.wOBA,
                wRCPlus: proj.wRCPlus,
                // Pitcher fields
                ip: proj.ip,
                w: proj.w,
                l: proj.l,
                era: proj.era,
                whip: proj.whip,
                so: proj.so,
                fip: proj.fip,
                sv: proj.sv,
                // Shared
                war: proj.war,
            });
        }

        return rows;
    }

    /**
     * Build actual stats rows from cached data
     */
    function buildActualData(statsMap) {
        if (!statsMap) return [];

        const players = getFilteredPlayers();
        const rows = [];

        for (const player of players) {
            if (!player.mlbId) continue;

            const pStats = statsMap[player.mlbId];
            if (!pStats) continue;

            const isPitcher = player.position === 'P';
            if (playerType === 'hitters' && isPitcher) continue;
            if (playerType === 'pitchers' && !isPitcher) continue;

            const group = isPitcher ? 'pitching' : 'hitting';
            const stat = pStats[group];
            if (!stat) continue;

            if (isPitcher) {
                rows.push({
                    mlbId: player.mlbId,
                    name: player.name,
                    mlbTeam: player.mlbTeam || '',
                    nplTeam: player.nplTeam || '',
                    isRostered: player.isRostered,
                    gamesPlayed: stat.gamesPlayed,
                    gamesStarted: stat.gamesStarted,
                    wins: stat.wins,
                    losses: stat.losses,
                    era: stat.era,
                    inningsPitched: stat.inningsPitched,
                    strikeOuts: stat.strikeOuts,
                    baseOnBalls: stat.baseOnBalls,
                    whip: stat.whip,
                    xFIP: '--', // placeholder until fetched
                });
            } else {
                rows.push({
                    mlbId: player.mlbId,
                    name: player.name,
                    mlbTeam: player.mlbTeam || '',
                    nplTeam: player.nplTeam || '',
                    isRostered: player.isRostered,
                    gamesPlayed: stat.gamesPlayed,
                    atBats: stat.atBats,
                    hits: stat.hits,
                    homeRuns: stat.homeRuns,
                    rbi: stat.rbi,
                    stolenBases: stat.stolenBases,
                    avg: stat.avg,
                    obp: stat.obp,
                    slg: stat.slg,
                    ops: stat.ops,
                    xwOBA: '--', // placeholder until fetched
                });
            }
        }

        return rows;
    }

    // ─── Table rendering ───

    function getColumns() {
        if (mode === 'projected') {
            return playerType === 'hitters' ? getProjectedHitterColumns() : getProjectedPitcherColumns();
        } else {
            return playerType === 'hitters' ? getActualHitterColumns() : getActualPitcherColumns();
        }
    }

    function getInitialSort() {
        if (mode === 'projected') {
            return { key: 'war', dir: 'desc' };
        }
        return { key: 'name', dir: 'asc' };
    }

    function rebuildTable(data) {
        const tableContainer = container.querySelector('#stats-table-container');
        tableContainer.innerHTML = '';

        const sort = getInitialSort();
        currentData = data;

        dataTable = createDataTable({
            data: data,
            columns: getColumns(),
            title: '',
            showCount: false,
            pageSize: 50,
            emptyMessage: mode === 'actual' && isLoadingActual
                ? 'Loading stats...'
                : 'No stats available for the current filters',
            initialSort: sort.key,
            initialSortDir: sort.dir,
        });
        tableContainer.appendChild(dataTable);

        updateCount(data.length);
    }

    function updateCount(count) {
        const countEl = container.querySelector('.result-count');
        if (countEl) {
            countEl.textContent = `${count} players`;
        }
    }

    function showLoading(show) {
        const indicator = container.querySelector('#stats-loading-indicator');
        if (indicator) {
            indicator.classList.toggle('hidden', !show);
        }
    }

    // ─── Mode/Type change handler ───

    async function onModeOrTypeChange() {
        if (mode === 'projected') {
            showLoading(false);
            const data = buildProjectedData();
            rebuildTable(data);
        } else {
            // Actual stats mode
            await loadActualStats();
        }
    }

    function applyFiltersAndRender() {
        if (mode === 'projected') {
            const data = buildProjectedData();
            rebuildTable(data);
        } else {
            // Rebuild actual stats rows from cached fetch data
            if (actualStatsCache.year === currentYear && actualStatsCache.raw) {
                const data = buildActualData(actualStatsCache.raw);
                rebuildTable(data);
                // Re-apply advanced stats from cache
                applyAdvancedStatsFromCache(data);
            } else {
                loadActualStats();
            }
        }
    }

    /**
     * Load actual stats from MLB API
     */
    async function loadActualStats() {
        isLoadingActual = true;
        showLoading(true);

        // Show empty table with loading message
        rebuildTable([]);

        try {
            // Get all players we need stats for
            const players = getFilteredPlayers().filter(p => p.mlbId);
            const mlbIds = players.map(p => p.mlbId);

            if (mlbIds.length === 0) {
                isLoadingActual = false;
                showLoading(false);
                rebuildTable([]);
                return;
            }

            // Fetch season stats in batch
            const statsMap = await fetchSeasonStatsBatch(mlbIds, currentYear);
            actualStatsCache.raw = statsMap;
            actualStatsCache.year = currentYear;

            // Build rows from the stats
            const data = buildActualData(statsMap);
            isLoadingActual = false;

            rebuildTable(data);

            // Now fetch advanced stats (xwOBA for hitters, xFIP for pitchers) in background
            fetchAdvancedStats(data, statsMap);
        } catch (error) {
            console.error('Error loading actual stats:', error);
            isLoadingActual = false;
            showLoading(false);
            rebuildTable([]);
        }
    }

    /**
     * Apply cached advanced stats to current data
     */
    function applyAdvancedStatsFromCache(data) {
        let updated = false;
        for (const row of data) {
            if (playerType === 'hitters') {
                const cacheKey = `stats_expected_${row.mlbId}_${currentYear}_hitting`;
                const cached = sessionCache.get(cacheKey);
                if (cached && cached.woba != null) {
                    row.xwOBA = cached.woba;
                    updated = true;
                }
            } else {
                const cacheKey = `stats_saber_${row.mlbId}_${currentYear}_pitching`;
                const cached = sessionCache.get(cacheKey);
                if (cached && cached.xfip != null) {
                    row.xFIP = cached.xfip;
                    updated = true;
                }
            }
        }
        if (updated && dataTable) {
            dataTable.updateData(data);
        }
    }

    /**
     * Fetch xwOBA (hitters) or xFIP (pitchers) in background batches
     */
    async function fetchAdvancedStats(data, statsMap) {
        if (data.length === 0) {
            showLoading(false);
            return;
        }

        if (playerType === 'hitters') {
            // Fetch expected stats for hitters
            await fetchInBatches(
                data,
                async (mlbId) => fetchExpectedStats(mlbId, currentYear, 'hitting'),
                (results) => {
                    // Update rows with xwOBA as batches complete
                    for (const { mlbId, data: expected } of results) {
                        const row = data.find(r => r.mlbId === mlbId);
                        if (row && expected && expected.woba != null) {
                            row.xwOBA = expected.woba;
                        }
                    }
                    if (dataTable) {
                        dataTable.updateData(data);
                    }
                }
            );
        } else {
            // Fetch sabermetrics for pitchers
            await fetchInBatches(
                data,
                async (mlbId) => fetchSabermetrics(mlbId, currentYear, 'pitching'),
                (results) => {
                    for (const { mlbId, data: saber } of results) {
                        const row = data.find(r => r.mlbId === mlbId);
                        if (row && saber && saber.xfip != null) {
                            row.xFIP = saber.xfip;
                        }
                    }
                    if (dataTable) {
                        dataTable.updateData(data);
                    }
                }
            );
        }

        showLoading(false);
    }

    // ─── Initial Load ───

    // Load projections if not cached
    if (!projectionsMap) {
        try {
            projectionsMap = await fetchAllProjections();
        } catch (error) {
            console.error('Error loading projections:', error);
            projectionsMap = {};
        }
    }

    // Initial render based on mode
    if (mode === 'projected') {
        const data = buildProjectedData();
        rebuildTable(data);
    } else {
        await loadActualStats();
    }

    return container;
}
