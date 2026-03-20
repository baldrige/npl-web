/**
 * MLB Stats API Integration
 * Fetches player statistics from statsapi.mlb.com
 */

import { sessionCache } from './cache.js';

const MLB_STATS_API = 'https://statsapi.mlb.com/api/v1';
const STATS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CACHE_VERSION = 'v2'; // bump to invalidate stale entries

// Minor league sport IDs to fetch
const MINOR_LEAGUE_SPORT_IDS = [11, 12, 13, 14, 16, 21, 22, 23];

/**
 * Fetch player stats from MLB Stats API (MLB + minor leagues)
 * @param {string} mlbId - MLB player ID
 * @param {string} statGroup - 'hitting', 'pitching', or 'hitting,pitching'
 * @returns {Promise<Object>} Player stats
 */
export async function fetchPlayerStats(mlbId, statGroup = 'hitting,pitching') {
    const cacheKey = `stats_${CACHE_VERSION}_${mlbId}_${statGroup}`;

    // Check cache first
    const cached = sessionCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        // Fetch MLB stats and all minor league levels in parallel
        const mlbUrl = `${MLB_STATS_API}/people/${mlbId}/stats?stats=yearByYear&group=${statGroup}`;
        const milbUrls = MINOR_LEAGUE_SPORT_IDS.map(sportId =>
            `${MLB_STATS_API}/people/${mlbId}/stats?stats=yearByYear&group=${statGroup}&sportId=${sportId}`
        );

        const [mlbResponse, ...milbResponses] = await Promise.all([
            fetch(mlbUrl),
            ...milbUrls.map(url => fetch(url).catch(() => null)),
        ]);

        if (!mlbResponse.ok) {
            throw new Error(`Failed to fetch stats: ${mlbResponse.status}`);
        }

        const mlbData = await mlbResponse.json();

        // Collect minor league data from successful responses
        const milbSplits = [];
        for (const resp of milbResponses) {
            if (resp && resp.ok) {
                const data = await resp.json();
                if (data.stats) {
                    for (const sg of data.stats) {
                        if (sg.splits) {
                            milbSplits.push(...sg.splits.map(split => ({
                                ...split,
                                _group: sg.group?.displayName?.toLowerCase(),
                            })));
                        }
                    }
                }
            }
        }

        const stats = parsePlayerStats(mlbData, milbSplits);

        // Cache the result
        sessionCache.set(cacheKey, stats, STATS_CACHE_TTL);

        return stats;
    } catch (error) {
        console.error(`Error fetching stats for ${mlbId}:`, error);
        return null;
    }
}

/**
 * Fetch player info from MLB Stats API
 * @param {string} mlbId - MLB player ID
 * @returns {Promise<Object>} Player info
 */
export async function fetchPlayerInfo(mlbId) {
    const cacheKey = `info_${CACHE_VERSION}_${mlbId}`;

    const cached = sessionCache.get(cacheKey);
    if (cached) {
        return cached;
    }

    try {
        const url = `${MLB_STATS_API}/people/${mlbId}?hydrate=rosterEntries`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch player info: ${response.status}`);
        }

        const data = await response.json();
        const info = parsePlayerInfo(data);

        sessionCache.set(cacheKey, info, STATS_CACHE_TTL);

        return info;
    } catch (error) {
        console.error(`Error fetching info for ${mlbId}:`, error);
        return null;
    }
}

/**
 * Fetch with timeout wrapper
 * @param {string} url - URL to fetch
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, timeout = 5000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

/**
 * Fetch player info for multiple players in parallel
 * @param {string[]} mlbIds - Array of MLB player IDs
 * @returns {Promise<Object>} Map of mlbId -> player info
 */
export async function fetchMultiplePlayerInfo(mlbIds) {
    const results = {};
    const uncachedIds = [];

    // Filter out invalid IDs and check cache
    for (const mlbId of mlbIds) {
        // Skip empty, null, undefined, or non-numeric IDs
        if (!mlbId || mlbId === '' || mlbId === 'undefined' || mlbId === 'null') {
            continue;
        }

        const cacheKey = `info_${CACHE_VERSION}_${mlbId}`;
        const cached = sessionCache.get(cacheKey);
        if (cached) {
            results[mlbId] = cached;
        } else {
            uncachedIds.push(mlbId);
        }
    }

    if (uncachedIds.length === 0) {
        return results;
    }

    // Fetch uncached players in batches with timeout
    const batchSize = 5; // Reduced batch size for reliability
    const fetchTimeout = 5000; // 5 second timeout per request

    for (let i = 0; i < uncachedIds.length; i += batchSize) {
        const batch = uncachedIds.slice(i, i + batchSize);
        const promises = batch.map(async (mlbId) => {
            try {
                const url = `${MLB_STATS_API}/people/${mlbId}?hydrate=rosterEntries`;
                const response = await fetchWithTimeout(url, fetchTimeout);

                if (!response.ok) {
                    return { mlbId, info: null };
                }

                const data = await response.json();
                const info = parsePlayerInfo(data);

                // Cache the result
                sessionCache.set(`info_${mlbId}`, info, STATS_CACHE_TTL);

                return { mlbId, info };
            } catch (error) {
                // Don't log timeout errors as they're expected
                if (error.name !== 'AbortError') {
                    console.error(`Error fetching info for ${mlbId}:`, error);
                }
                return { mlbId, info: null };
            }
        });

        const batchResults = await Promise.all(promises);
        for (const { mlbId, info } of batchResults) {
            if (info) {
                results[mlbId] = info;
            }
        }

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < uncachedIds.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    return results;
}

/**
 * Parse a single split into a season stats object
 */
function parseSplit(split) {
    const season = split.season;
    const team = split.team?.name || '';
    const teamAbbr = split.team?.abbreviation || '';
    const league = split.league?.name || '';
    const sportId = split.sport?.id;
    const sportName = split.sport?.name || '';
    const stat = split.stat || {};
    const level = getLevelLabel(sportId, sportName);

    return {
        season,
        team,
        teamAbbr,
        league,
        level,
        sportId,
        ...stat,
    };
}

/**
 * Parse stats response into structured object
 * Separates MLB (sport.id === 1) from minor league stats
 * @param {Object} data - MLB API response
 * @param {Array} milbSplits - Pre-fetched minor league splits (with _group field)
 */
function parsePlayerStats(data, milbSplits = []) {
    const result = {
        hitting: [],
        pitching: [],
        minorLeague: {
            hitting: [],
            pitching: [],
        },
        career: {
            hitting: null,
            pitching: null,
        },
        minorLeagueCareer: {
            hitting: null,
            pitching: null,
        },
    };

    if (!data.stats || !Array.isArray(data.stats)) {
        return result;
    }

    // Parse MLB stats from main response
    for (const statGroup of data.stats) {
        const group = statGroup.group?.displayName?.toLowerCase();
        const splits = statGroup.splits || [];

        for (const split of splits) {
            const seasonStats = parseSplit(split);

            if (group === 'hitting') {
                result.hitting.push(seasonStats);
            } else if (group === 'pitching') {
                result.pitching.push(seasonStats);
            }
        }
    }

    // Parse minor league stats from separate fetches
    for (const split of milbSplits) {
        const group = split._group;
        const seasonStats = parseSplit(split);

        if (group === 'hitting') {
            result.minorLeague.hitting.push(seasonStats);
        } else if (group === 'pitching') {
            result.minorLeague.pitching.push(seasonStats);
        }
    }

    // Sort by season descending (most recent first), then by level descending (highest first)
    const sortStats = (a, b) => {
        const seasonDiff = parseInt(b.season) - parseInt(a.season);
        if (seasonDiff !== 0) return seasonDiff;
        return (a.sportId || 999) - (b.sportId || 999); // lower sportId = higher level
    };

    result.hitting.sort(sortStats);
    result.pitching.sort(sortStats);
    result.minorLeague.hitting.sort(sortStats);
    result.minorLeague.pitching.sort(sortStats);

    // Calculate career totals (MLB only)
    if (result.hitting.length > 0) {
        result.career.hitting = calculateCareerHitting(result.hitting);
    }
    if (result.pitching.length > 0) {
        result.career.pitching = calculateCareerPitching(result.pitching);
    }

    // Calculate minor league career totals
    if (result.minorLeague.hitting.length > 0) {
        result.minorLeagueCareer.hitting = calculateCareerHitting(result.minorLeague.hitting);
    }
    if (result.minorLeague.pitching.length > 0) {
        result.minorLeagueCareer.pitching = calculateCareerPitching(result.minorLeague.pitching);
    }

    return result;
}

/**
 * Get a short level label from sport ID/name
 */
function getLevelLabel(sportId, sportName) {
    const levelMap = {
        11: 'AAA',
        12: 'AA',
        13: 'A+',
        14: 'A',
        16: 'Rk',
        17: 'WIN', // Winter leagues
        21: 'A+',  // High-A (newer classification)
        22: 'CPX', // Complex league
        23: 'A',   // Single-A (newer)
        51: 'INT', // International
    };
    if (sportId === 1) return 'MLB';
    if (levelMap[sportId]) return levelMap[sportId];
    // Fallback: try to parse from sport name
    if (sportName.includes('Triple')) return 'AAA';
    if (sportName.includes('Double')) return 'AA';
    if (sportName.includes('High')) return 'A+';
    if (sportName.includes('Single') || sportName.includes('Low')) return 'A';
    if (sportName.includes('Rookie') || sportName.includes('Complex')) return 'Rk';
    return 'MiLB';
}

/**
 * Parse player info response
 */
function parsePlayerInfo(data) {
    const person = data.people?.[0];
    if (!person) return null;

    const rosterStatus = parseRosterStatus(person.rosterEntries);

    return {
        mlbId: person.id,
        fullName: person.fullName,
        firstName: person.firstName,
        lastName: person.lastName,
        birthDate: person.birthDate,
        currentAge: person.currentAge,
        birthCity: person.birthCity,
        birthStateProvince: person.birthStateProvince,
        birthCountry: person.birthCountry,
        height: person.height,
        weight: person.weight,
        primaryPosition: person.primaryPosition?.abbreviation,
        batSide: person.batSide?.code,
        pitchHand: person.pitchHand?.code,
        mlbDebutDate: person.mlbDebutDate,
        currentTeam: person.currentTeam?.name,
        currentTeamAbbr: person.currentTeam?.abbreviation,
        active: person.active,
        rosterStatus: rosterStatus,
    };
}

/**
 * Parse roster entries to determine current roster status
 * Finds the most recent entry without an endDate (i.e. current)
 */
function parseRosterStatus(rosterEntries) {
    if (!rosterEntries || rosterEntries.length === 0) return null;

    // Find current entry: no endDate, or most recent statusDate
    let current = null;
    for (const entry of rosterEntries) {
        if (!entry.endDate) {
            // Active entry — pick the one with the latest statusDate
            if (!current || !current.endDate &&
                (entry.statusDate || '') > (current.statusDate || '')) {
                current = entry;
            }
        }
    }

    // Fallback: most recent by statusDate if all have endDates
    if (!current) {
        current = rosterEntries.reduce((latest, entry) =>
            (entry.statusDate || '') > (latest.statusDate || '') ? entry : latest
        );
    }

    const statusCode = current.status?.code || current.statusCode || '';
    const statusDescription = current.status?.description || getRosterStatusLabel(statusCode);
    return {
        statusCode,
        statusDescription,
        team: current.team?.name || '',
        teamAbbr: current.team?.abbreviation || '',
        isOn40Man: current.isActiveFortyMan ?? false,
        jerseyNumber: current.jerseyNumber || '',
    };
}

/**
 * Map roster status codes to human-readable labels
 */
function getRosterStatusLabel(code) {
    const labels = {
        'A': 'Active',
        'RM': 'Removed',
        'RSN': 'Reassigned',
        'DES': 'Designated for Assignment',
        'D7': '7-Day IL',
        'D10': '10-Day IL',
        'D15': '15-Day IL',
        'D60': '60-Day IL',
        'SU': 'Suspended',
        'PL': 'Paternity List',
        'BRV': 'Bereavement List',
        'RA': 'Rehab Assignment',
        'MIN': 'Minor Leagues',
        'FA': 'Free Agent',
        'NRI': 'Non-Roster Invitee',
        'REL': 'Released',
        'RES': 'Restricted List',
        'OPT': 'Optioned',
        'OUT': 'Outrighted',
        'DFA': 'Designated for Assignment',
        'WVR': 'Waivers',
        'ASG': 'Assigned',
    };
    return labels[code] || code || 'Unknown';
}

/**
 * Calculate career hitting totals
 */
function calculateCareerHitting(seasons) {
    const totals = {
        seasons: seasons.length,
        gamesPlayed: 0,
        atBats: 0,
        runs: 0,
        hits: 0,
        doubles: 0,
        triples: 0,
        homeRuns: 0,
        rbi: 0,
        stolenBases: 0,
        caughtStealing: 0,
        baseOnBalls: 0,
        strikeOuts: 0,
    };

    for (const s of seasons) {
        totals.gamesPlayed += parseInt(s.gamesPlayed) || 0;
        totals.atBats += parseInt(s.atBats) || 0;
        totals.runs += parseInt(s.runs) || 0;
        totals.hits += parseInt(s.hits) || 0;
        totals.doubles += parseInt(s.doubles) || 0;
        totals.triples += parseInt(s.triples) || 0;
        totals.homeRuns += parseInt(s.homeRuns) || 0;
        totals.rbi += parseInt(s.rbi) || 0;
        totals.stolenBases += parseInt(s.stolenBases) || 0;
        totals.caughtStealing += parseInt(s.caughtStealing) || 0;
        totals.baseOnBalls += parseInt(s.baseOnBalls) || 0;
        totals.strikeOuts += parseInt(s.strikeOuts) || 0;
    }

    // Calculate rate stats
    totals.avg = totals.atBats > 0 ? (totals.hits / totals.atBats).toFixed(3) : '.000';
    totals.obp = calculateOBP(totals);
    totals.slg = calculateSLG(totals);
    totals.ops = (parseFloat(totals.obp) + parseFloat(totals.slg)).toFixed(3);

    return totals;
}

/**
 * Calculate career pitching totals
 */
function calculateCareerPitching(seasons) {
    const totals = {
        seasons: seasons.length,
        wins: 0,
        losses: 0,
        gamesPlayed: 0,
        gamesStarted: 0,
        completeGames: 0,
        shutouts: 0,
        saves: 0,
        inningsPitched: 0,
        hits: 0,
        runs: 0,
        earnedRuns: 0,
        homeRuns: 0,
        baseOnBalls: 0,
        strikeOuts: 0,
    };

    for (const s of seasons) {
        totals.wins += parseInt(s.wins) || 0;
        totals.losses += parseInt(s.losses) || 0;
        totals.gamesPlayed += parseInt(s.gamesPlayed) || 0;
        totals.gamesStarted += parseInt(s.gamesStarted) || 0;
        totals.completeGames += parseInt(s.completeGames) || 0;
        totals.shutouts += parseInt(s.shutouts) || 0;
        totals.saves += parseInt(s.saves) || 0;
        totals.inningsPitched += parseInnings(s.inningsPitched);
        totals.hits += parseInt(s.hits) || 0;
        totals.runs += parseInt(s.runs) || 0;
        totals.earnedRuns += parseInt(s.earnedRuns) || 0;
        totals.homeRuns += parseInt(s.homeRuns) || 0;
        totals.baseOnBalls += parseInt(s.baseOnBalls) || 0;
        totals.strikeOuts += parseInt(s.strikeOuts) || 0;
    }

    // Calculate rate stats
    totals.era = totals.inningsPitched > 0
        ? ((totals.earnedRuns * 9) / totals.inningsPitched).toFixed(2)
        : '0.00';
    totals.whip = totals.inningsPitched > 0
        ? ((totals.baseOnBalls + totals.hits) / totals.inningsPitched).toFixed(2)
        : '0.00';
    totals.k9 = totals.inningsPitched > 0
        ? ((totals.strikeOuts * 9) / totals.inningsPitched).toFixed(1)
        : '0.0';
    totals.bb9 = totals.inningsPitched > 0
        ? ((totals.baseOnBalls * 9) / totals.inningsPitched).toFixed(1)
        : '0.0';
    totals.inningsPitched = totals.inningsPitched.toFixed(1);

    return totals;
}

/**
 * Parse innings pitched (handles "123.2" format)
 */
function parseInnings(ip) {
    if (!ip) return 0;
    const str = String(ip);
    const parts = str.split('.');
    const whole = parseInt(parts[0]) || 0;
    const fraction = parseInt(parts[1]) || 0;
    return whole + (fraction / 3);
}

/**
 * Calculate OBP
 */
function calculateOBP(stats) {
    const { hits, baseOnBalls, atBats } = stats;
    const hbp = stats.hitByPitch || 0;
    const sf = stats.sacFlies || 0;
    const pa = atBats + baseOnBalls + hbp + sf;
    if (pa === 0) return '.000';
    return ((hits + baseOnBalls + hbp) / pa).toFixed(3);
}

/**
 * Calculate SLG
 */
function calculateSLG(stats) {
    const { hits, doubles, triples, homeRuns, atBats } = stats;
    if (atBats === 0) return '.000';
    const singles = hits - doubles - triples - homeRuns;
    const totalBases = singles + (doubles * 2) + (triples * 3) + (homeRuns * 4);
    return (totalBases / atBats).toFixed(3);
}

/**
 * Format stats for display in player modal
 */
export function formatStatsHTML(stats, position) {
    if (!stats) {
        return '<p class="text-muted">Stats unavailable</p>';
    }

    const isPitcher = position === 'P' || position === 'RHP' || position === 'LHP';
    const hasMinorLeague = stats.minorLeague &&
        (stats.minorLeague.hitting.length > 0 || stats.minorLeague.pitching.length > 0);

    let html = '';

    // MLB stats
    if (isPitcher && stats.pitching.length > 0) {
        html += formatPitchingStats(stats);
    } else if (stats.hitting.length > 0) {
        html += formatHittingStats(stats);
    }

    // Show both if player has both
    if (!isPitcher && stats.pitching.length > 0) {
        html += formatPitchingStats(stats);
    }
    if (isPitcher && stats.hitting.length > 0 && stats.hitting.some(s => s.atBats > 0)) {
        html += formatHittingStats(stats);
    }

    // Minor league stats
    if (hasMinorLeague) {
        if (isPitcher && stats.minorLeague.pitching.length > 0) {
            html += formatMinorLeaguePitchingStats(stats);
        } else if (stats.minorLeague.hitting.length > 0) {
            html += formatMinorLeagueHittingStats(stats);
        }

        if (!isPitcher && stats.minorLeague.pitching.length > 0) {
            html += formatMinorLeaguePitchingStats(stats);
        }
        if (isPitcher && stats.minorLeague.hitting.length > 0 &&
            stats.minorLeague.hitting.some(s => s.atBats > 0)) {
            html += formatMinorLeagueHittingStats(stats);
        }
    }

    return html || '<p class="text-muted">No stats available</p>';
}

/**
 * Format hitting stats table
 */
function formatHittingStats(stats) {
    const recent = stats.hitting.slice(0, 5); // Last 5 seasons
    const career = stats.career.hitting;

    let html = `
        <div class="stats-section">
            <h4>Batting Stats</h4>
            <div class="data-table-container">
                <table class="data-table stats-table">
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Team</th>
                            <th class="text-right">G</th>
                            <th class="text-right">AB</th>
                            <th class="text-right">H</th>
                            <th class="text-right">HR</th>
                            <th class="text-right">RBI</th>
                            <th class="text-right">SB</th>
                            <th class="text-right">AVG</th>
                            <th class="text-right">OBP</th>
                            <th class="text-right">SLG</th>
                            <th class="text-right">OPS</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    for (const s of recent) {
        html += `
            <tr>
                <td>${s.season}</td>
                <td>${s.teamAbbr || s.team}</td>
                <td class="text-right">${s.gamesPlayed || 0}</td>
                <td class="text-right">${s.atBats || 0}</td>
                <td class="text-right">${s.hits || 0}</td>
                <td class="text-right">${s.homeRuns || 0}</td>
                <td class="text-right">${s.rbi || 0}</td>
                <td class="text-right">${s.stolenBases || 0}</td>
                <td class="text-right">${s.avg || '.000'}</td>
                <td class="text-right">${s.obp || '.000'}</td>
                <td class="text-right">${s.slg || '.000'}</td>
                <td class="text-right">${s.ops || '.000'}</td>
            </tr>
        `;
    }

    if (career && career.seasons > 1) {
        html += `
            <tr class="career-row font-bold">
                <td>Career</td>
                <td>${career.seasons} yrs</td>
                <td class="text-right">${career.gamesPlayed}</td>
                <td class="text-right">${career.atBats}</td>
                <td class="text-right">${career.hits}</td>
                <td class="text-right">${career.homeRuns}</td>
                <td class="text-right">${career.rbi}</td>
                <td class="text-right">${career.stolenBases}</td>
                <td class="text-right">${career.avg}</td>
                <td class="text-right">${career.obp}</td>
                <td class="text-right">${career.slg}</td>
                <td class="text-right">${career.ops}</td>
            </tr>
        `;
    }

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

/**
 * Format pitching stats table
 */
function formatPitchingStats(stats) {
    const recent = stats.pitching.slice(0, 5); // Last 5 seasons
    const career = stats.career.pitching;

    let html = `
        <div class="stats-section">
            <h4>Pitching Stats</h4>
            <div class="data-table-container">
                <table class="data-table stats-table">
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Team</th>
                            <th class="text-right">W</th>
                            <th class="text-right">L</th>
                            <th class="text-right">ERA</th>
                            <th class="text-right">G</th>
                            <th class="text-right">GS</th>
                            <th class="text-right">SV</th>
                            <th class="text-right">IP</th>
                            <th class="text-right">K</th>
                            <th class="text-right">BB</th>
                            <th class="text-right">WHIP</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    for (const s of recent) {
        html += `
            <tr>
                <td>${s.season}</td>
                <td>${s.teamAbbr || s.team}</td>
                <td class="text-right">${s.wins || 0}</td>
                <td class="text-right">${s.losses || 0}</td>
                <td class="text-right">${s.era || '0.00'}</td>
                <td class="text-right">${s.gamesPlayed || 0}</td>
                <td class="text-right">${s.gamesStarted || 0}</td>
                <td class="text-right">${s.saves || 0}</td>
                <td class="text-right">${s.inningsPitched || '0.0'}</td>
                <td class="text-right">${s.strikeOuts || 0}</td>
                <td class="text-right">${s.baseOnBalls || 0}</td>
                <td class="text-right">${s.whip || '0.00'}</td>
            </tr>
        `;
    }

    if (career && career.seasons > 1) {
        html += `
            <tr class="career-row font-bold">
                <td>Career</td>
                <td>${career.seasons} yrs</td>
                <td class="text-right">${career.wins}</td>
                <td class="text-right">${career.losses}</td>
                <td class="text-right">${career.era}</td>
                <td class="text-right">${career.gamesPlayed}</td>
                <td class="text-right">${career.gamesStarted}</td>
                <td class="text-right">${career.saves}</td>
                <td class="text-right">${career.inningsPitched}</td>
                <td class="text-right">${career.strikeOuts}</td>
                <td class="text-right">${career.baseOnBalls}</td>
                <td class="text-right">${career.whip}</td>
            </tr>
        `;
    }

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

/**
 * Format minor league hitting stats table
 */
function formatMinorLeagueHittingStats(stats) {
    const seasons = stats.minorLeague.hitting;
    const career = stats.minorLeagueCareer.hitting;

    let html = `
        <div class="stats-section">
            <h4>Minor League Batting</h4>
            <div class="data-table-container">
                <table class="data-table stats-table">
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Lvl</th>
                            <th>Team</th>
                            <th class="text-right">G</th>
                            <th class="text-right">AB</th>
                            <th class="text-right">H</th>
                            <th class="text-right">HR</th>
                            <th class="text-right">RBI</th>
                            <th class="text-right">SB</th>
                            <th class="text-right">AVG</th>
                            <th class="text-right">OBP</th>
                            <th class="text-right">OPS</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    for (const s of seasons) {
        html += `
            <tr>
                <td>${s.season}</td>
                <td><span class="level-badge level-${(s.level || '').toLowerCase().replace('+', 'plus')}">${s.level || ''}</span></td>
                <td>${s.teamAbbr || s.team}</td>
                <td class="text-right">${s.gamesPlayed || 0}</td>
                <td class="text-right">${s.atBats || 0}</td>
                <td class="text-right">${s.hits || 0}</td>
                <td class="text-right">${s.homeRuns || 0}</td>
                <td class="text-right">${s.rbi || 0}</td>
                <td class="text-right">${s.stolenBases || 0}</td>
                <td class="text-right">${s.avg || '.000'}</td>
                <td class="text-right">${s.obp || '.000'}</td>
                <td class="text-right">${s.ops || '.000'}</td>
            </tr>
        `;
    }

    if (career && career.seasons > 1) {
        html += `
            <tr class="career-row font-bold">
                <td>MiLB</td>
                <td></td>
                <td>${career.seasons} yrs</td>
                <td class="text-right">${career.gamesPlayed}</td>
                <td class="text-right">${career.atBats}</td>
                <td class="text-right">${career.hits}</td>
                <td class="text-right">${career.homeRuns}</td>
                <td class="text-right">${career.rbi}</td>
                <td class="text-right">${career.stolenBases}</td>
                <td class="text-right">${career.avg}</td>
                <td class="text-right">${career.obp}</td>
                <td class="text-right">${career.ops}</td>
            </tr>
        `;
    }

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}

/**
 * Format minor league pitching stats table
 */
function formatMinorLeaguePitchingStats(stats) {
    const seasons = stats.minorLeague.pitching;
    const career = stats.minorLeagueCareer.pitching;

    let html = `
        <div class="stats-section">
            <h4>Minor League Pitching</h4>
            <div class="data-table-container">
                <table class="data-table stats-table">
                    <thead>
                        <tr>
                            <th>Year</th>
                            <th>Lvl</th>
                            <th>Team</th>
                            <th class="text-right">W</th>
                            <th class="text-right">L</th>
                            <th class="text-right">ERA</th>
                            <th class="text-right">G</th>
                            <th class="text-right">IP</th>
                            <th class="text-right">K</th>
                            <th class="text-right">BB</th>
                            <th class="text-right">WHIP</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    for (const s of seasons) {
        html += `
            <tr>
                <td>${s.season}</td>
                <td><span class="level-badge level-${(s.level || '').toLowerCase().replace('+', 'plus')}">${s.level || ''}</span></td>
                <td>${s.teamAbbr || s.team}</td>
                <td class="text-right">${s.wins || 0}</td>
                <td class="text-right">${s.losses || 0}</td>
                <td class="text-right">${s.era || '0.00'}</td>
                <td class="text-right">${s.gamesPlayed || 0}</td>
                <td class="text-right">${s.inningsPitched || '0.0'}</td>
                <td class="text-right">${s.strikeOuts || 0}</td>
                <td class="text-right">${s.baseOnBalls || 0}</td>
                <td class="text-right">${s.whip || '0.00'}</td>
            </tr>
        `;
    }

    if (career && career.seasons > 1) {
        html += `
            <tr class="career-row font-bold">
                <td>MiLB</td>
                <td></td>
                <td>${career.seasons} yrs</td>
                <td class="text-right">${career.wins}</td>
                <td class="text-right">${career.losses}</td>
                <td class="text-right">${career.era}</td>
                <td class="text-right">${career.gamesPlayed}</td>
                <td class="text-right">${career.inningsPitched}</td>
                <td class="text-right">${career.strikeOuts}</td>
                <td class="text-right">${career.baseOnBalls}</td>
                <td class="text-right">${career.whip}</td>
            </tr>
        `;
    }

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    return html;
}
