/**
 * Data Transformation Utilities
 * Normalizes and transforms player/team data
 */

import { NPL_TEAMS, MLB_TEAMS } from '../api/sheets.js';

/**
 * Normalize player data from various sources
 * @param {Object} rawPlayer - Raw player object from CSV
 * @param {Object} context - Additional context (rostered map, etc.)
 * @returns {Object} Normalized player object
 */
export function normalizePlayer(rawPlayer, context = {}) {
    const { rosteredMap = {}, draftDataMap = {} } = context;

    // Extract MLBID (handle different field names)
    const mlbId = rawPlayer.mlbid || rawPlayer.MLBID || rawPlayer.mlbId || rawPlayer.id || '';

    // Get roster info if available
    const rosterInfo = rosteredMap[mlbId] || {};
    const draftInfo = draftDataMap[mlbId] || {};

    // Normalize position
    const position = normalizePosition(
        rawPlayer.position || rawPlayer.pos || rawPlayer.primaryPosition || draftInfo.position || ''
    );

    // Build normalized player object
    return {
        mlbId: mlbId,
        name: rawPlayer.name || rawPlayer.fullName || rawPlayer.playerName ||
              `${rawPlayer.firstName || ''} ${rawPlayer.lastName || ''}`.trim() || 'Unknown',
        firstName: rawPlayer.firstName || rawPlayer.firstname || '',
        lastName: rawPlayer.lastName || rawPlayer.lastname || '',
        position: position,
        positions: parsePositions(rawPlayer.positions || position),
        mlbTeamId: rawPlayer.mlbTeamId || rawPlayer.teamId || rawPlayer.mlbTeam || rosterInfo.mlbTeamId || '',
        mlbTeam: getMLBTeamAbbr(rawPlayer.mlbTeamId || rawPlayer.teamId || rawPlayer.mlbTeam || rosterInfo.mlbTeamId),
        nplTeamId: rosterInfo.nplTeamId || rawPlayer.nplTeamId || rawPlayer.nplTeam || '',
        nplTeam: getNPLTeamName(rosterInfo.nplTeamId || rawPlayer.nplTeamId || rawPlayer.nplTeam),
        age: parseInt(rawPlayer.age) || null,
        bats: rawPlayer.bats || rawPlayer.batSide || '',
        throws: rawPlayer.throws || rawPlayer.throwHand || '',
        height: rawPlayer.height || '',
        weight: rawPlayer.weight || '',
        birthDate: rawPlayer.birthDate || rawPlayer.dob || '',
        debut: rawPlayer.mlbDebutDate || rawPlayer.debut || '',

        // Draft/scouting data
        rank: parseInt(rawPlayer.rank) || parseInt(draftInfo.rank) || null,
        fv: rawPlayer.fv || draftInfo.fv || '',
        eta: rawPlayer.eta || draftInfo.eta || '',
        scoutingReport: rawPlayer.scoutingReport || rawPlayer.report || draftInfo.scoutingReport || '',
        risk: rawPlayer.risk || draftInfo.risk || '',

        // Status flags
        isRostered: !!rosterInfo.nplTeamId,
        isPicked: false, // Set from localStorage
        isWatching: false, // Set from localStorage
    };
}

/**
 * Normalize position abbreviation
 * @param {string} pos - Raw position string
 * @returns {string} Normalized position
 */
export function normalizePosition(pos) {
    if (!pos) return '';

    const posMap = {
        'pitcher': 'P',
        'starting pitcher': 'P',
        'relief pitcher': 'P',
        'sp': 'P',
        'rp': 'P',
        'catcher': 'C',
        'first base': '1B',
        'first baseman': '1B',
        '1b': '1B',
        'second base': '2B',
        'second baseman': '2B',
        '2b': '2B',
        'third base': '3B',
        'third baseman': '3B',
        '3b': '3B',
        'shortstop': 'SS',
        'ss': 'SS',
        'outfield': 'OF',
        'outfielder': 'OF',
        'left field': 'OF',
        'center field': 'OF',
        'right field': 'OF',
        'lf': 'OF',
        'cf': 'OF',
        'rf': 'OF',
        'designated hitter': 'DH',
        'dh': 'DH',
        'utility': 'UTIL',
        'util': 'UTIL',
        'two-way player': 'TWP',
        'twp': 'TWP',
    };

    const normalized = pos.toLowerCase().trim();
    return posMap[normalized] || pos.toUpperCase();
}

/**
 * Parse multiple positions from string
 * @param {string} posStr - Positions string (e.g., "SS/2B" or "SS, 2B")
 * @returns {Array<string>} Array of positions
 */
export function parsePositions(posStr) {
    if (!posStr) return [];

    const positions = posStr
        .split(/[\/,\s]+/)
        .map(p => normalizePosition(p.trim()))
        .filter(p => p);

    return [...new Set(positions)]; // Remove duplicates
}

/**
 * Get MLB team abbreviation from ID
 * @param {string|number} teamId - MLB team ID
 * @returns {string} Team abbreviation
 */
export function getMLBTeamAbbr(teamId) {
    if (!teamId) return '';
    const team = MLB_TEAMS[String(teamId)];
    return team ? team.abbr : String(teamId);
}

/**
 * Get MLB team full name from ID
 * @param {string|number} teamId - MLB team ID
 * @returns {string} Team full name
 */
export function getMLBTeamName(teamId) {
    if (!teamId) return '';
    const team = MLB_TEAMS[String(teamId)];
    return team ? team.name : '';
}

/**
 * Get NPL team name from ID
 * @param {string|number} teamId - NPL team ID
 * @returns {string} Team name
 */
export function getNPLTeamName(teamId) {
    if (!teamId) return 'Free Agent';
    const team = NPL_TEAMS.find(t => String(t.id) === String(teamId));
    return team ? team.name : 'Unknown';
}

/**
 * Get NPL team by ID
 * @param {string|number} teamId - NPL team ID
 * @returns {Object|null} Team object
 */
export function getNPLTeam(teamId) {
    if (!teamId) return null;
    return NPL_TEAMS.find(t => String(t.id) === String(teamId)) || null;
}

/**
 * Build a lookup map from array by key
 * @param {Array<Object>} array - Array of objects
 * @param {string} key - Key to use for lookup
 * @returns {Object} Lookup map
 */
export function buildLookupMap(array, key) {
    const map = {};
    for (const item of array) {
        const keyValue = item[key];
        if (keyValue) {
            map[keyValue] = item;
        }
    }
    return map;
}

/**
 * Group array by key
 * @param {Array<Object>} array - Array of objects
 * @param {string} key - Key to group by
 * @returns {Object} Grouped object
 */
export function groupBy(array, key) {
    const groups = {};
    for (const item of array) {
        const groupKey = item[key] || 'unknown';
        if (!groups[groupKey]) {
            groups[groupKey] = [];
        }
        groups[groupKey].push(item);
    }
    return groups;
}

/**
 * Sort array by key
 * @param {Array<Object>} array - Array to sort
 * @param {string} key - Key to sort by
 * @param {string} direction - 'asc' or 'desc'
 * @returns {Array<Object>} Sorted array
 */
export function sortBy(array, key, direction = 'asc') {
    const multiplier = direction === 'desc' ? -1 : 1;

    return [...array].sort((a, b) => {
        let aVal = a[key];
        let bVal = b[key];

        // Handle null/undefined
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        // Handle numbers
        if (typeof aVal === 'number' && typeof bVal === 'number') {
            return (aVal - bVal) * multiplier;
        }

        // Handle strings
        aVal = String(aVal).toLowerCase();
        bVal = String(bVal).toLowerCase();

        if (aVal < bVal) return -1 * multiplier;
        if (aVal > bVal) return 1 * multiplier;
        return 0;
    });
}

/**
 * Filter array by search term
 * @param {Array<Object>} array - Array to filter
 * @param {string} searchTerm - Search term
 * @param {Array<string>} fields - Fields to search in
 * @returns {Array<Object>} Filtered array
 */
export function filterBySearch(array, searchTerm, fields = ['name']) {
    if (!searchTerm) return array;

    const term = searchTerm.toLowerCase().trim();

    return array.filter(item => {
        return fields.some(field => {
            const value = item[field];
            if (value == null) return false;
            return String(value).toLowerCase().includes(term);
        });
    });
}

/**
 * Filter players by position
 * @param {Array<Object>} players - Players array
 * @param {string} position - Position to filter by
 * @returns {Array<Object>} Filtered players
 */
export function filterByPosition(players, position) {
    if (!position || position === 'ALL') return players;

    return players.filter(player => {
        if (player.position === position) return true;
        if (player.positions && player.positions.includes(position)) return true;
        return false;
    });
}

/**
 * Calculate team roster statistics
 * @param {Array<Object>} roster - Team roster array
 * @returns {Object} Roster statistics
 */
export function calculateRosterStats(roster) {
    const positionCounts = {};
    let totalAge = 0;
    let ageCount = 0;

    for (const player of roster) {
        // Count positions
        const pos = player.position || 'Unknown';
        positionCounts[pos] = (positionCounts[pos] || 0) + 1;

        // Sum ages
        if (player.age) {
            totalAge += player.age;
            ageCount++;
        }
    }

    return {
        total: roster.length,
        byPosition: positionCounts,
        avgAge: ageCount > 0 ? (totalAge / ageCount).toFixed(1) : null,
        pitchers: positionCounts['P'] || 0,
        hitters: roster.length - (positionCounts['P'] || 0),
    };
}

/**
 * Debounce function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = 300) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
