/**
 * Fangraphs Projections
 * Loads player projections from local JSON file
 *
 * To update projections:
 * 1. Open fetch-projections.html in your browser
 * 2. Click "Fetch Projections" then "Download JSON"
 * 3. Save the file to data/projections.json
 */

import { sessionCache } from './cache.js';

const PROJECTIONS_FILE = './data/projections.json';
const PROJECTIONS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// In-memory cache for projections map
let projectionsMapCache = null;

/**
 * Fetch all projections and build lookup map by MLB ID
 * @returns {Promise<Object>} Map of mlbId -> projection data
 */
export async function fetchAllProjections() {
    // Check memory cache first
    if (projectionsMapCache) {
        return projectionsMapCache;
    }

    // Check session cache
    const cacheKey = 'fg_all_projections';
    const cached = sessionCache.get(cacheKey);
    if (cached) {
        projectionsMapCache = cached;
        return cached;
    }

    try {
        const response = await fetch(PROJECTIONS_FILE);

        if (!response.ok) {
            console.warn('Projections file not found. Run fetch-projections.html to download.');
            return {};
        }

        const data = await response.json();
        const projectionsMap = buildProjectionsMap(data);

        // Cache the results
        sessionCache.set(cacheKey, projectionsMap, PROJECTIONS_CACHE_TTL);
        projectionsMapCache = projectionsMap;

        console.log(`Loaded ${Object.keys(projectionsMap).length} player projections`);
        return projectionsMap;
    } catch (error) {
        console.error('Error loading projections:', error);
        return {};
    }
}

/**
 * Build projections lookup map from data
 */
function buildProjectionsMap(data) {
    const projectionsMap = {};

    // Add batters
    if (data.batters) {
        for (const proj of data.batters) {
            if (proj.mlbId) {
                projectionsMap[proj.mlbId] = {
                    ...proj,
                    war: proj.war !== null ? parseFloat(proj.war) : null,
                };
            }
        }
    }

    // Add pitchers (may overwrite for two-way players, keep higher WAR)
    if (data.pitchers) {
        for (const proj of data.pitchers) {
            if (proj.mlbId) {
                if (projectionsMap[proj.mlbId]) {
                    // Keep higher WAR for two-way players
                    const existingWAR = projectionsMap[proj.mlbId].war || 0;
                    const pitcherWAR = proj.war || 0;
                    if (pitcherWAR > existingWAR) {
                        projectionsMap[proj.mlbId] = {
                            ...proj,
                            war: parseFloat(pitcherWAR),
                        };
                    }
                } else {
                    projectionsMap[proj.mlbId] = {
                        ...proj,
                        war: proj.war !== null ? parseFloat(proj.war) : null,
                    };
                }
            }
        }
    }

    return projectionsMap;
}

/**
 * Format projection data for display in modal
 */
export function formatProjectionHTML(projection) {
    if (!projection) {
        return '';
    }

    if (projection.isPitcher) {
        return formatPitcherProjection(projection);
    } else {
        return formatBatterProjection(projection);
    }
}

/**
 * Format batter projection display
 */
function formatBatterProjection(proj) {
    return `
        <div class="stats-section">
            <h4>2026 Projected Stats (Fangraphs)</h4>
            <div class="player-stats-grid">
                ${proj.war !== null ? `
                    <div class="player-stat">
                        <div class="player-stat-value ${getWARClass(proj.war)}">${proj.war.toFixed(1)}</div>
                        <div class="player-stat-label">WAR</div>
                    </div>
                ` : ''}
                ${proj.pa ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${Math.round(proj.pa)}</div>
                        <div class="player-stat-label">PA</div>
                    </div>
                ` : ''}
                ${proj.hr ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${Math.round(proj.hr)}</div>
                        <div class="player-stat-label">HR</div>
                    </div>
                ` : ''}
                ${proj.rbi ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${Math.round(proj.rbi)}</div>
                        <div class="player-stat-label">RBI</div>
                    </div>
                ` : ''}
                ${proj.sb ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${Math.round(proj.sb)}</div>
                        <div class="player-stat-label">SB</div>
                    </div>
                ` : ''}
                ${proj.avg ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${proj.avg.toFixed(3)}</div>
                        <div class="player-stat-label">AVG</div>
                    </div>
                ` : ''}
                ${proj.obp ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${proj.obp.toFixed(3)}</div>
                        <div class="player-stat-label">OBP</div>
                    </div>
                ` : ''}
                ${proj.ops ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${proj.ops.toFixed(3)}</div>
                        <div class="player-stat-label">OPS</div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Format pitcher projection display
 */
function formatPitcherProjection(proj) {
    return `
        <div class="stats-section">
            <h4>2026 Projected Stats (Fangraphs)</h4>
            <div class="player-stats-grid">
                ${proj.war !== null ? `
                    <div class="player-stat">
                        <div class="player-stat-value ${getWARClass(proj.war)}">${proj.war.toFixed(1)}</div>
                        <div class="player-stat-label">WAR</div>
                    </div>
                ` : ''}
                ${proj.ip ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${proj.ip.toFixed(1)}</div>
                        <div class="player-stat-label">IP</div>
                    </div>
                ` : ''}
                ${proj.w !== undefined ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${proj.w}-${proj.l || 0}</div>
                        <div class="player-stat-label">W-L</div>
                    </div>
                ` : ''}
                ${proj.era ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${proj.era.toFixed(2)}</div>
                        <div class="player-stat-label">ERA</div>
                    </div>
                ` : ''}
                ${proj.whip ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${proj.whip.toFixed(2)}</div>
                        <div class="player-stat-label">WHIP</div>
                    </div>
                ` : ''}
                ${proj.so ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${Math.round(proj.so)}</div>
                        <div class="player-stat-label">K</div>
                    </div>
                ` : ''}
                ${proj.fip ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${proj.fip.toFixed(2)}</div>
                        <div class="player-stat-label">FIP</div>
                    </div>
                ` : ''}
                ${proj.sv ? `
                    <div class="player-stat">
                        <div class="player-stat-value">${Math.round(proj.sv)}</div>
                        <div class="player-stat-label">SV</div>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
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
