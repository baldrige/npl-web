/**
 * Data Fetching Layer
 * Loads roster data directly from Google Sheets
 */

import { parseCSV } from '../utils/csvParser.js';
import { sessionCache } from './cache.js';
import { fetchAllProjections } from './fangraphs.js';

// Rosters Google Sheet ID
const ROSTERS_SHEET_ID = '1On6uRXLRQ3pzl2FHYRgWKCedsCdl6UNbNaSF6pwlGiw';

// All NPL Team tabs with their GIDs
const TEAM_TABS = {
    'Bears': { gid: '1617726388', id: 9 },
    'Bosses': { gid: '1268413619', id: 23 },
    'Bulldog': { gid: '621210992', id: 18 },
    'Calling': { gid: '1292807714', id: 17 },
    'Cheddar': { gid: '1198362618', id: 1 },
    'DockHounds': { gid: '1060609465', id: 5 },
    'Ducksnorts': { gid: '913365009', id: 12 },
    'GmbH': { gid: '740851946', id: 13 },
    'Guys': { gid: '1744826582', id: 21 },
    'Hitmen': { gid: '788554871', id: 14 },
    'King': { gid: '530338826', id: 6 },
    'Kodiaks': { gid: '381368372', id: 7 },
    'McFlys': { gid: '678819826', id: 22 },
    'Orphans': { gid: '55729550', id: 11 },
    'Perwar': { gid: '2133779717', id: 4 },
    'Quails': { gid: '2039332207', id: 16 },
    'Rats': { gid: '1000428793', id: 8 },
    'Ropes': { gid: '167583566', id: 19 },
    'Speedsters': { gid: '148890259', id: 3 },
    'Starks': { gid: '1959689065', id: 20 },
    'Tobacconists': { gid: '1129830405', id: 15 },
    'TOOTBLANs': { gid: '1773672958', id: 10 },
    'Valkyries': { gid: '1016125334', id: 2 },
    'Villagers': { gid: '734520611', id: 24 },
};

// Cache TTL (5 minutes)
const CACHE_TTL = 5 * 60 * 1000;

/**
 * NPL Teams data
 */
export const NPL_TEAMS = Object.entries(TEAM_TABS).map(([name, data]) => ({
    id: data.id,
    name: name,
    gid: data.gid,
    abbr: name.substring(0, 3).toUpperCase(),
})).sort((a, b) => a.id - b.id);

/**
 * MLB Teams mapping (ID -> abbreviation)
 */
export const MLB_TEAMS = {
    '108': { abbr: 'LAA', name: 'Los Angeles Angels' },
    '109': { abbr: 'ARI', name: 'Arizona Diamondbacks' },
    '110': { abbr: 'BAL', name: 'Baltimore Orioles' },
    '111': { abbr: 'BOS', name: 'Boston Red Sox' },
    '112': { abbr: 'CHC', name: 'Chicago Cubs' },
    '113': { abbr: 'CIN', name: 'Cincinnati Reds' },
    '114': { abbr: 'CLE', name: 'Cleveland Guardians' },
    '115': { abbr: 'COL', name: 'Colorado Rockies' },
    '116': { abbr: 'DET', name: 'Detroit Tigers' },
    '117': { abbr: 'HOU', name: 'Houston Astros' },
    '118': { abbr: 'KC', name: 'Kansas City Royals' },
    '119': { abbr: 'LAD', name: 'Los Angeles Dodgers' },
    '120': { abbr: 'WSH', name: 'Washington Nationals' },
    '121': { abbr: 'NYM', name: 'New York Mets' },
    '133': { abbr: 'OAK', name: 'Oakland Athletics' },
    '134': { abbr: 'PIT', name: 'Pittsburgh Pirates' },
    '135': { abbr: 'SD', name: 'San Diego Padres' },
    '136': { abbr: 'SEA', name: 'Seattle Mariners' },
    '137': { abbr: 'SF', name: 'San Francisco Giants' },
    '138': { abbr: 'STL', name: 'St. Louis Cardinals' },
    '139': { abbr: 'TB', name: 'Tampa Bay Rays' },
    '140': { abbr: 'TEX', name: 'Texas Rangers' },
    '141': { abbr: 'TOR', name: 'Toronto Blue Jays' },
    '142': { abbr: 'MIN', name: 'Minnesota Twins' },
    '143': { abbr: 'PHI', name: 'Philadelphia Phillies' },
    '144': { abbr: 'ATL', name: 'Atlanta Braves' },
    '145': { abbr: 'CWS', name: 'Chicago White Sox' },
    '146': { abbr: 'MIA', name: 'Miami Marlins' },
    '147': { abbr: 'NYY', name: 'New York Yankees' },
    '158': { abbr: 'MIL', name: 'Milwaukee Brewers' },
};

// MLB team abbreviation lookup (handles spaces and variations)
const MLB_ABBR_MAP = {};
Object.entries(MLB_TEAMS).forEach(([id, team]) => {
    MLB_ABBR_MAP[team.abbr.toLowerCase()] = id;
    MLB_ABBR_MAP[team.abbr.toLowerCase().trim()] = id;
});
// Add common variations
Object.assign(MLB_ABBR_MAP, {
    'cha': '145', 'chw': '145', 'cws': '145',
    'nya': '147', 'nyy': '147',
    'nyn': '121', 'nym': '121',
    'sln': '138', 'stl': '138',
    'sfn': '137', 'sf': '137', 'sfg': '137',
    'lan': '119', 'lad': '119',
    'ana': '108', 'laa': '108',
    'tba': '139', 'tb': '139', 'tbr': '139',
    'kca': '118', 'kc': '118', 'kcr': '118',
    'sdn': '135', 'sd': '135', 'sdp': '135',
    'was': '120', 'wsh': '120',
    'ath': '133', 'oak': '133',
    'fa': '', 'npb': '', '': '',
});

/**
 * Build Google Sheets gviz URL (works without publishing)
 */
function buildGvizURL(sheetId, gid) {
    return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

/**
 * Fetch a single team's roster from Google Sheets
 */
async function fetchTeamRoster(teamName, teamData) {
    const url = buildGvizURL(ROSTERS_SHEET_ID, teamData.gid);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${teamName}: ${response.status}`);
        }

        const csvText = await response.text();
        const rows = parseCSV(csvText, { header: false });

        return parseTeamRoster(rows, teamName, teamData.id);
    } catch (error) {
        console.error(`Error fetching ${teamName}:`, error);
        return [];
    }
}

/**
 * Parse roster rows into player objects
 * Format: status, name, ssId, mlbId, position, mlbTeam, serviceTime, options, status, salaries...
 */
function parseTeamRoster(rows, teamName, teamId) {
    const players = [];
    let currentSection = '';
    let past30Man = false; // true once we hit IL/option/restricted sections

    // Sections that are NOT part of the 30-man active roster
    const NON_30MAN_SECTIONS = [
        'INJURED', 'OPTION', 'RESTRICTED', 'ASSIGNED', 'TRIPLE-A',
        'UNIVERSAL BASEBALL', 'END OF SEASON',
    ];

    for (const row of rows) {
        // Skip empty rows
        if (!row || row.length < 5) continue;

        const col0 = String(row[0] || '').trim();
        const col1 = String(row[1] || '').trim();
        const col2 = String(row[2] || '').trim();
        const col3 = String(row[3] || '').trim();
        const col4 = String(row[4] || '').trim();
        const col5 = String(row[5] || '').trim();

        // Detect section headers (any row where col1 is all-caps label with no MLB ID)
        const isSection = col1 && !col3 && /^[A-Z][A-Z\s\-]+$/.test(col1);
        if (isSection) {
            currentSection = col1;
            if (NON_30MAN_SECTIONS.some(s => col1.includes(s))) {
                past30Man = true;
            }
            continue;
        }

        // Skip header rows and non-player rows
        if (col0 === '' && col1 === '') continue;
        if (col1.includes('ACTIVE') || col1.includes('RESERVE') || col1.includes('MINOR')) continue;
        if (col4 === 'POS' || col4 === 'MLB') continue;

        // Check if this looks like a player row (col0 is "1" or number, col3 is MLB ID)
        const mlbId = col3;
        if (!mlbId || !/^\d{5,7}$/.test(mlbId)) continue;

        // Parse player name (format: "Last, First" or "Last, First (Note)")
        const nameRaw = col1;
        let name = nameRaw.replace(/\s*\([^)]*\)\s*/g, '').trim();
        const nameParts = name.split(',').map(s => s.trim());
        const lastName = nameParts[0] || '';
        const firstName = nameParts[1] || '';
        const fullName = firstName ? `${firstName} ${lastName}` : lastName;

        // Parse position
        const position = normalizePosition(col4);

        // Parse MLB team
        const mlbTeamRaw = col5.trim().toLowerCase();
        const mlbTeamId = MLB_ABBR_MAP[mlbTeamRaw] || '';
        const mlbTeam = mlbTeamId ? (MLB_TEAMS[mlbTeamId]?.abbr || '') : col5.trim().toUpperCase();

        players.push({
            mlbId: mlbId,
            name: fullName,
            firstName,
            lastName,
            position,
            positions: [position].filter(Boolean),
            mlbTeamId,
            mlbTeam,
            nplTeamId: teamId,
            nplTeam: teamName,
            ssId: col2, // Strat-O-Matic or internal ID
            rosterStatus: col0, // "1" = active 30-man roster
            isRostered: true,
            on30Man: !past30Man && col0 === '1',
            section: currentSection,
        });
    }

    return players;
}

/**
 * Normalize position abbreviation
 */
function normalizePosition(pos) {
    if (!pos) return '';
    const p = pos.toUpperCase().trim();

    const posMap = {
        'RHP': 'P', 'LHP': 'P', 'P': 'P',
        'C': 'C',
        '1B': '1B',
        '2B': '2B',
        '3B': '3B',
        'SS': 'SS',
        'LF': 'OF', 'CF': 'OF', 'RF': 'OF', 'OF': 'OF',
        'DH': 'DH',
        'UT': 'UTIL', 'UTIL': 'UTIL',
    };

    return posMap[p] || p;
}

/**
 * Data store for application state
 */
class DataStore {
    constructor() {
        this.players = [];
        this.teamRosters = {};
        this.isLoaded = false;
        this.isLoading = false;
        this.lastRefresh = null;
        this.listeners = [];
        this.loadProgress = { loaded: 0, total: 24 };
    }

    subscribe(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    notify() {
        this.listeners.forEach(callback => callback(this));
    }

    async loadAll(forceRefresh = false) {
        if (this.isLoading) return;

        const cacheKey = 'all_rosters';

        // Check cache first
        if (!forceRefresh) {
            const cached = sessionCache.get(cacheKey);
            if (cached) {
                this.players = cached.players;
                this.teamRosters = cached.teamRosters;
                this.isLoaded = true;
                this.lastRefresh = new Date(cached.timestamp);
                this.notify();
                console.log('Loaded from cache:', this.players.length, 'players');
                return;
            }
        }

        this.isLoading = true;
        this.loadProgress = { loaded: 0, total: Object.keys(TEAM_TABS).length };
        this.notify();

        try {
            const allPlayers = [];
            const teamRosters = {};

            // Fetch all teams in parallel (in batches to avoid overwhelming)
            const teamEntries = Object.entries(TEAM_TABS);
            const batchSize = 6;

            for (let i = 0; i < teamEntries.length; i += batchSize) {
                const batch = teamEntries.slice(i, i + batchSize);
                const results = await Promise.all(
                    batch.map(([name, data]) => fetchTeamRoster(name, data))
                );

                batch.forEach(([name, data], idx) => {
                    const roster = results[idx];
                    teamRosters[data.id] = roster;
                    allPlayers.push(...roster);
                });

                this.loadProgress.loaded = Math.min(i + batchSize, teamEntries.length);
                this.notify();
            }

            // Load free agents from Fangraphs projections
            const rosteredMlbIds = new Set(allPlayers.map(p => p.mlbId));
            const freeAgents = await this.loadFreeAgentsFromProjections(rosteredMlbIds);
            allPlayers.push(...freeAgents);

            this.players = allPlayers;
            this.teamRosters = teamRosters;
            this.isLoaded = true;
            this.lastRefresh = new Date();

            // Cache the results
            sessionCache.set(cacheKey, {
                players: allPlayers,
                teamRosters,
                timestamp: Date.now(),
            }, CACHE_TTL);

            console.log('Loaded from Google Sheets:', this.players.length - freeAgents.length, 'rostered players across', Object.keys(teamRosters).length, 'teams');
            console.log('Loaded from Fangraphs:', freeAgents.length, 'free agents with projections');
            this.notify();
        } catch (error) {
            console.error('Error loading data:', error);
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Load free agents from Fangraphs projections
     * @param {Set} rosteredMlbIds - Set of MLB IDs already rostered
     * @returns {Array} Array of free agent player objects
     */
    async loadFreeAgentsFromProjections(rosteredMlbIds) {
        try {
            const projectionsMap = await fetchAllProjections();
            const freeAgents = [];

            for (const [mlbId, projection] of Object.entries(projectionsMap)) {
                // Skip if already rostered
                if (rosteredMlbIds.has(mlbId)) continue;

                // Skip players with very low WAR projections (filter out noise)
                if (projection.war == null || projection.war < 0.0) continue;

                // Determine position
                let position = 'DH';
                if (projection.isPitcher) {
                    position = 'P';
                }

                // Get MLB team abbreviation
                const mlbTeam = projection.team || '';

                freeAgents.push({
                    mlbId: mlbId,
                    name: projection.name || 'Unknown',
                    firstName: projection.name ? projection.name.split(' ')[0] : '',
                    lastName: projection.name ? projection.name.split(' ').slice(1).join(' ') : '',
                    position: position,
                    positions: [position],
                    mlbTeam: mlbTeam,
                    mlbTeamId: '',
                    nplTeamId: null,
                    nplTeam: null,
                    isRostered: false,
                    projectedWAR: projection.war,
                    projection: projection,
                    // Add some projection stats for display
                    age: null,
                    bats: null,
                    throws: null,
                });
            }

            // Sort by projected WAR descending
            freeAgents.sort((a, b) => (b.projectedWAR || 0) - (a.projectedWAR || 0));

            return freeAgents;
        } catch (error) {
            console.error('Error loading free agents from projections:', error);
            return [];
        }
    }

    getTeamRoster(teamId) {
        if (!teamId) return [];
        return this.players.filter(p => String(p.nplTeamId) === String(teamId));
    }

    getFreeAgents() {
        return this.players.filter(p => !p.isRostered);
    }

    getPlayer(mlbId) {
        return this.players.find(p => p.mlbId === String(mlbId)) || null;
    }

    searchPlayers(query, filters = {}) {
        let results = this.players;

        if (query) {
            const q = query.toLowerCase();
            results = results.filter(p =>
                p.name.toLowerCase().includes(q) ||
                (p.mlbTeam && p.mlbTeam.toLowerCase().includes(q)) ||
                (p.nplTeam && p.nplTeam.toLowerCase().includes(q))
            );
        }

        if (filters.position && filters.position !== 'ALL') {
            results = results.filter(p =>
                p.position === filters.position ||
                (p.positions && p.positions.includes(filters.position))
            );
        }

        if (filters.mlbTeam) {
            results = results.filter(p => p.mlbTeam === filters.mlbTeam);
        }

        if (filters.nplTeamId) {
            results = results.filter(p => String(p.nplTeamId) === String(filters.nplTeamId));
        }

        if (filters.rostered === true) {
            results = results.filter(p => p.isRostered);
        } else if (filters.rostered === false) {
            results = results.filter(p => !p.isRostered);
        }

        return results;
    }

    async refresh() {
        sessionCache.clear();
        await this.loadAll(true);
    }
}

// Export singleton instance
export const dataStore = new DataStore();

/**
 * Show toast notification
 */
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
