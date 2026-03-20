/**
 * Home View - Dashboard
 */

import { dataStore, NPL_TEAMS } from '../api/sheets.js';
import { router } from '../router.js';

/**
 * Render the home view
 * @returns {HTMLElement} View element
 */
export async function renderHome() {
    // Ensure data is loaded
    if (!dataStore.isLoaded) {
        await dataStore.loadAll();
    }

    const container = document.createElement('div');
    container.className = 'home-view';

    // Calculate stats
    const totalPlayers = dataStore.players.length;
    const rosteredPlayers = dataStore.players.filter(p => p.isRostered).length;
    const freeAgents = totalPlayers - rosteredPlayers;
    const teamsWithRosters = new Set(dataStore.players.filter(p => p.nplTeamId).map(p => p.nplTeamId)).size;

    container.innerHTML = `
        <div class="view-header">
            <h1>National Pastime League</h1>
            <p>24-team fantasy baseball simulation league</p>
        </div>

        <!-- Quick Stats -->
        <div class="quick-stats mb-lg">
            <div class="quick-stat">
                <div class="stat-value">${totalPlayers.toLocaleString()}</div>
                <div class="stat-label">Total Players</div>
            </div>
            <div class="quick-stat">
                <div class="stat-value">${rosteredPlayers.toLocaleString()}</div>
                <div class="stat-label">Rostered Players</div>
            </div>
            <div class="quick-stat">
                <div class="stat-value">${freeAgents.toLocaleString()}</div>
                <div class="stat-label">Free Agents</div>
            </div>
            <div class="quick-stat">
                <div class="stat-value">${teamsWithRosters}</div>
                <div class="stat-label">Active Teams</div>
            </div>
        </div>

        <!-- Quick Links -->
        <div class="grid grid-2 mb-lg">
            <div class="card">
                <div class="card-header">
                    <h3>Quick Actions</h3>
                </div>
                <div class="card-body">
                    <div class="flex flex-col gap-sm">
                        <a href="#/rosters" class="btn btn-primary">View Team Rosters</a>
                        <a href="#/players" class="btn btn-secondary">Search Players</a>
                    </div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3>Data Status</h3>
                </div>
                <div class="card-body">
                    <div class="flex flex-col gap-sm text-sm">
                        <div class="flex justify-between">
                            <span class="text-muted">Last Updated:</span>
                            <span>${dataStore.lastRefresh ? formatTime(dataStore.lastRefresh) : 'Never'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted">Data Source:</span>
                            <span>Google Sheets</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-muted">Cache:</span>
                            <span class="badge badge-success">Active</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Teams Overview -->
        <div class="card">
            <div class="card-header">
                <h3>NPL Teams</h3>
            </div>
            <div class="card-body">
                <div class="team-selector">
                    ${NPL_TEAMS.map(team => {
                        const rosterSize = dataStore.getTeamRoster(team.id).length;
                        return `
                            <button
                                class="team-chip"
                                onclick="location.hash='#/rosters?team=${team.id}'"
                            >
                                ${team.name}
                                <span class="text-muted text-xs">(${rosterSize})</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;

    return container;
}

/**
 * Format timestamp
 * @param {Date} date - Date object
 * @returns {string} Formatted time string
 */
function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
