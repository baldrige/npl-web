/**
 * Standings View - League Standings and Team Stats
 */

import { dataStore, NPL_TEAMS } from '../api/sheets.js';
import { createDataTable, column } from '../components/dataTable.js';
import { calculateRosterStats } from '../utils/dataTransform.js';
import { fetchAllProjections } from '../api/fangraphs.js';

/**
 * Render the standings view
 * @returns {HTMLElement} View element
 */
export async function renderStandings() {
    // Ensure data is loaded
    if (!dataStore.isLoaded) {
        await dataStore.loadAll();
    }

    const container = document.createElement('div');
    container.className = 'standings-view';

    // Load projections
    const projectionsMap = await fetchAllProjections();

    // Calculate team statistics including WAR
    const teamStats = NPL_TEAMS.map(team => {
        const roster = dataStore.getTeamRoster(team.id);
        const stats = calculateRosterStats(roster);

        // Calculate position breakdown
        const positions = stats.byPosition;

        // Calculate WAR by type
        let batterWAR = 0;
        let pitcherWAR = 0;

        roster.forEach(player => {
            const projection = projectionsMap[player.mlbId];
            if (projection && projection.war != null) {
                if (projection.isPitcher) {
                    pitcherWAR += projection.war;
                } else {
                    batterWAR += projection.war;
                }
            }
        });

        const totalWAR = batterWAR + pitcherWAR;

        return {
            id: team.id,
            name: team.name,
            abbr: team.abbr,
            rosterSize: stats.total,
            pitchers: stats.pitchers,
            hitters: stats.hitters,
            avgAge: stats.avgAge || '-',
            catchers: positions['C'] || 0,
            infielders: (positions['1B'] || 0) + (positions['2B'] || 0) + (positions['3B'] || 0) + (positions['SS'] || 0),
            outfielders: positions['OF'] || 0,
            batterWAR: batterWAR,
            pitcherWAR: pitcherWAR,
            totalWAR: totalWAR,
        };
    }).sort((a, b) => b.totalWAR - a.totalWAR);

    // Calculate league totals
    const leagueTotalWAR = teamStats.reduce((sum, t) => sum + t.totalWAR, 0);
    const leagueBatterWAR = teamStats.reduce((sum, t) => sum + t.batterWAR, 0);
    const leaguePitcherWAR = teamStats.reduce((sum, t) => sum + t.pitcherWAR, 0);

    const leagueTotals = {
        totalPlayers: dataStore.players.filter(p => p.isRostered).length,
        totalPitchers: dataStore.players.filter(p => p.isRostered && p.position === 'P').length,
        totalHitters: dataStore.players.filter(p => p.isRostered && p.position !== 'P').length,
        freeAgents: dataStore.players.filter(p => !p.isRostered).length,
        totalWAR: leagueTotalWAR,
        batterWAR: leagueBatterWAR,
        pitcherWAR: leaguePitcherWAR,
    };

    container.innerHTML = `
        <div class="view-header">
            <h1>Standings & Stats</h1>
            <p>League standings and team statistics</p>
        </div>

        <!-- League Summary -->
        <div class="quick-stats mb-lg">
            <div class="quick-stat">
                <div class="stat-value">${leagueTotals.totalPlayers.toLocaleString()}</div>
                <div class="stat-label">Rostered Players</div>
            </div>
            <div class="quick-stat">
                <div class="stat-value">${leagueTotals.totalWAR.toFixed(1)}</div>
                <div class="stat-label">Total Proj. WAR</div>
            </div>
            <div class="quick-stat">
                <div class="stat-value">${leagueTotals.batterWAR.toFixed(1)}</div>
                <div class="stat-label">Batter WAR</div>
            </div>
            <div class="quick-stat">
                <div class="stat-value">${leagueTotals.pitcherWAR.toFixed(1)}</div>
                <div class="stat-label">Pitcher WAR</div>
            </div>
        </div>

        <!-- Tabs -->
        <div class="tabs">
            <button class="tab active" data-tab="war-rankings">WAR Rankings</button>
            <button class="tab" data-tab="roster-stats">Roster Stats</button>
        </div>

        <!-- Tab Content -->
        <div id="tab-content">
            <div id="war-rankings-tab" class="tab-panel"></div>
            <div id="roster-stats-tab" class="tab-panel hidden"></div>
        </div>
    `;

    // Tab switching
    const tabs = container.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.dataset.tab;
            container.querySelectorAll('.tab-panel').forEach(panel => {
                panel.classList.add('hidden');
            });
            container.querySelector(`#${tabName}-tab`).classList.remove('hidden');
        });
    });

    // WAR Rankings Table
    const warRankingsTab = container.querySelector('#war-rankings-tab');

    // Add rank to team stats
    const rankedTeamStats = teamStats.map((team, idx) => ({
        ...team,
        rank: idx + 1,
    }));

    const warRankingsTable = createDataTable({
        data: rankedTeamStats,
        columns: [
            column('rank', '#', { type: 'number', sortable: false, align: 'center' }),
            column('name', 'Team', { sortable: true }),
            column('totalWAR', 'Total WAR', {
                sortable: true,
                align: 'right',
                render: (value) => `<strong>${value.toFixed(1)}</strong>`,
            }),
            column('batterWAR', 'Batter WAR', {
                sortable: true,
                align: 'right',
                render: (value) => value.toFixed(1),
            }),
            column('pitcherWAR', 'Pitcher WAR', {
                sortable: true,
                align: 'right',
                render: (value) => value.toFixed(1),
            }),
            column('rosterSize', 'Roster', { type: 'number', sortable: true, align: 'right' }),
            column('avgAge', 'Avg Age', { sortable: true, align: 'right' }),
        ],
        title: '2026 Projected WAR Rankings',
        pageSize: 30,
        clickable: true,
        onRowClick: (team) => {
            location.hash = `#/rosters?team=${team.id}`;
        },
        initialSort: 'totalWAR',
        initialSortDir: 'desc',
    });
    warRankingsTab.appendChild(warRankingsTable);

    // Roster Stats Table
    const rosterStatsTab = container.querySelector('#roster-stats-tab');
    const rosterStatsTable = createDataTable({
        data: teamStats,
        columns: [
            column('name', 'Team', { sortable: true }),
            column('rosterSize', 'Total', { type: 'number', sortable: true, align: 'right' }),
            column('pitchers', 'P', { type: 'number', sortable: true, align: 'right' }),
            column('catchers', 'C', { type: 'number', sortable: true, align: 'right' }),
            column('infielders', 'IF', { type: 'number', sortable: true, align: 'right' }),
            column('outfielders', 'OF', { type: 'number', sortable: true, align: 'right' }),
            column('avgAge', 'Avg Age', { sortable: true, align: 'right' }),
        ],
        title: 'Team Roster Breakdown',
        pageSize: 30,
        clickable: true,
        onRowClick: (team) => {
            location.hash = `#/rosters?team=${team.id}`;
        },
        initialSort: 'rosterSize',
        initialSortDir: 'desc',
    });
    rosterStatsTab.appendChild(rosterStatsTable);

    return container;
}

