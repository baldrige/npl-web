/**
 * Scoresheet Data Module
 * Loads pre-fetched Scoresheet roster data and compares with NPL rosters.
 */

import { sessionCache } from './cache.js';

const CACHE_KEY = 'scoresheet_rosters';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Load Scoresheet roster data from pre-fetched JSON file.
 * @returns {Promise<Object>} Scoresheet data { year, round, fetchedAt, teams, rosters }
 */
export async function loadScoresheetData() {
    const cached = sessionCache.get(CACHE_KEY);
    if (cached) return cached;

    const response = await fetch('./data/scoresheet_rosters.json');
    if (!response.ok) {
        throw new Error(
            'Scoresheet data not found. Run "node scripts/fetch-scoresheet.js" or use fetch-scoresheet.html to download it.'
        );
    }

    const data = await response.json();
    sessionCache.set(CACHE_KEY, data, CACHE_TTL);
    return data;
}

/**
 * Compare Scoresheet rosters with NPL rosters.
 * @param {Object} ssData - Scoresheet data from loadScoresheetData()
 * @param {Array} nplPlayers - Player array from dataStore.players
 * @returns {Object} Comparison results
 */
export function compareScoresheetWithNPL(ssData, nplPlayers) {
    // Build Scoresheet lookup by MLBAM ID
    const ssByMlbam = new Map();
    for (const entry of ssData.rosters) {
        if (entry.mlbam) {
            ssByMlbam.set(String(entry.mlbam), entry);
        }
    }

    // Build NPL lookup by mlbId (only active 30-man roster, matching npl30scrape's roster == "1")
    const nplByMlbId = new Map();
    for (const player of nplPlayers) {
        if (player.isRostered && player.mlbId && player.rosterStatus === '1') {
            nplByMlbId.set(String(player.mlbId), player);
        }
    }

    const missingFromNPL = [];    // On Scoresheet but not NPL
    const missingFromSS = [];     // On NPL but not Scoresheet
    const matched = [];           // On both

    // Check each Scoresheet player
    for (const [mlbam, ssPlayer] of ssByMlbam) {
        const nplPlayer = nplByMlbId.get(mlbam);
        if (nplPlayer) {
            matched.push({
                name: `${ssPlayer.firstName} ${ssPlayer.lastName}`.trim() || nplPlayer.name,
                mlbam,
                position: ssPlayer.pos || nplPlayer.position,
                ssTeam: ssPlayer.ssTeam,
                nplTeam: nplPlayer.nplTeam,
            });
        } else {
            missingFromNPL.push({
                name: `${ssPlayer.firstName} ${ssPlayer.lastName}`.trim(),
                mlbam,
                position: ssPlayer.pos,
                ssTeam: ssPlayer.ssTeam,
                nplTeam: '—',
                status: 'Not on NPL',
            });
        }
    }

    // Check each NPL player
    for (const [mlbId, nplPlayer] of nplByMlbId) {
        if (!ssByMlbam.has(mlbId)) {
            missingFromSS.push({
                name: nplPlayer.name,
                mlbam: mlbId,
                position: nplPlayer.position,
                ssTeam: '—',
                nplTeam: nplPlayer.nplTeam,
                status: 'Not on SS',
            });
        }
    }

    // Build team-level summary with data-driven mapping
    const summary = buildTeamSummary(ssData, matched, missingFromNPL, missingFromSS);

    return { missingFromNPL, missingFromSS, matched, summary };
}

/**
 * Build per-team summary, mapping SS teams to NPL teams by player overlap.
 */
function buildTeamSummary(ssData, matched, missingFromNPL, missingFromSS) {
    // Count SS roster sizes
    const ssTeamCounts = {};
    for (const entry of ssData.rosters) {
        ssTeamCounts[entry.ssTeam] = (ssTeamCounts[entry.ssTeam] || 0) + 1;
    }

    // Map SS teams to NPL teams by counting shared players
    const overlapCounts = {}; // { ssTeam: { nplTeam: count } }
    for (const m of matched) {
        if (!overlapCounts[m.ssTeam]) overlapCounts[m.ssTeam] = {};
        overlapCounts[m.ssTeam][m.nplTeam] = (overlapCounts[m.ssTeam][m.nplTeam] || 0) + 1;
    }

    // For each SS team, find the NPL team with the most overlap
    const ssToNpl = {};
    for (const ssTeam of Object.keys(overlapCounts)) {
        let bestNpl = null;
        let bestCount = 0;
        for (const [nplTeam, count] of Object.entries(overlapCounts[ssTeam])) {
            if (count > bestCount) {
                bestNpl = nplTeam;
                bestCount = count;
            }
        }
        ssToNpl[ssTeam] = bestNpl;
    }

    // Count NPL roster sizes per mapped team
    const nplTeamCounts = {};
    for (const m of matched) {
        nplTeamCounts[m.nplTeam] = (nplTeamCounts[m.nplTeam] || 0) + 1;
    }
    // Add players missing from SS (they are on NPL but not SS)
    for (const m of missingFromSS) {
        nplTeamCounts[m.nplTeam] = (nplTeamCounts[m.nplTeam] || 0) + 1;
    }

    // Build summary rows
    const summary = [];
    for (const ssTeam of ssData.teams) {
        const nplTeam = ssToNpl[ssTeam] || '—';
        const ssCount = ssTeamCounts[ssTeam] || 0;
        const matchedCount = matched.filter(m => m.ssTeam === ssTeam).length;
        const missingCount = missingFromNPL.filter(m => m.ssTeam === ssTeam).length;

        summary.push({
            ssTeam,
            ssCount,
            nplTeam,
            nplCount: nplTeamCounts[nplTeam] || 0,
            matchedCount,
            unmatchedCount: missingCount,
        });
    }

    return summary;
}
