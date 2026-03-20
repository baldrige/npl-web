/**
 * NPL League Site - Main Application Entry Point
 */

import { router } from './router.js';
import { dataStore, showToast } from './api/sheets.js';
import { renderNavbar } from './components/navbar.js';

// Import views
import { renderHome } from './views/home.js';
import { renderRosters } from './views/rosters.js';
import { renderPlayers } from './views/players.js';
import { renderStandings } from './views/standings.js';
import { renderMap } from './views/map.js';
import { renderStats } from './views/stats.js';

/**
 * Initialize the application
 */
async function initApp() {
    console.log('NPL League Site initializing...');

    // Render navigation
    renderNavbar();

    // Register routes
    router.register('home', renderHome);
    router.register('rosters', renderRosters);
    router.register('players', renderPlayers);
    router.register('standings', renderStandings);
    router.register('map', renderMap);
    router.register('stats', renderStats);

    // Initialize router
    router.init('view-container');

    // Pre-load data in background
    try {
        await dataStore.loadAll();
        console.log('Data loaded successfully:', {
            players: dataStore.players.length,
            teams: Object.keys(dataStore.teamRosters).length,
        });
    } catch (error) {
        console.error('Failed to load initial data:', error);
        showToast('Failed to load data. Please refresh.', 'error');
    }

    console.log('NPL League Site initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Handle errors globally
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

// Export for debugging
window.NPL = {
    dataStore,
    router,
};
