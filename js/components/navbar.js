/**
 * Navigation Bar Component
 */

import { router } from '../router.js';
import { dataStore, showToast } from '../api/sheets.js';

/**
 * Render the navigation bar
 */
export function renderNavbar() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    navbar.className = 'navbar';
    navbar.innerHTML = `
        <a href="#/home" class="navbar-brand">
            <span class="navbar-logo">&#9918;</span>
            <span>NPL</span>
        </a>

        <button class="navbar-toggle" aria-label="Toggle navigation">
            &#9776;
        </button>

        <nav class="navbar-nav">
            <a href="#/home" class="nav-link" data-route="home">
                <span>Home</span>
            </a>
            <a href="#/rosters" class="nav-link" data-route="rosters">
                <span>Rosters</span>
            </a>
            <a href="#/players" class="nav-link" data-route="players">
                <span>Players</span>
            </a>
            <a href="#/standings" class="nav-link" data-route="standings">
                <span>Standings</span>
            </a>
            <a href="#/map" class="nav-link" data-route="map">
                <span>Map</span>
            </a>
            <a href="#/stats" class="nav-link" data-route="stats">
                <span>Stats</span>
            </a>
            <a href="#/ss-check" class="nav-link" data-route="ss-check">
                <span>SS Check</span>
            </a>
        </nav>

        <div class="navbar-actions">
            <button class="refresh-btn" id="refresh-data-btn" title="Refresh data from Google Sheets">
                <span class="refresh-icon">&#8635;</span>
                <span class="refresh-text">Refresh</span>
            </button>
        </div>
    `;

    // Set up event listeners
    setupNavbarEvents();

    // Update active link based on current route
    router.updateNavLinks(router.getCurrentRoute());
}

/**
 * Set up navbar event listeners
 */
function setupNavbarEvents() {
    // Mobile menu toggle
    const toggleBtn = document.querySelector('.navbar-toggle');
    const nav = document.querySelector('.navbar-nav');

    if (toggleBtn && nav) {
        toggleBtn.addEventListener('click', () => {
            nav.classList.toggle('open');
        });

        // Close mobile menu when clicking a link
        nav.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                nav.classList.remove('open');
            });
        });
    }

    // Refresh button
    const refreshBtn = document.getElementById('refresh-data-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', handleRefresh);
    }
}

/**
 * Handle refresh button click
 */
async function handleRefresh() {
    const refreshBtn = document.getElementById('refresh-data-btn');
    if (!refreshBtn || refreshBtn.classList.contains('loading')) return;

    refreshBtn.classList.add('loading');

    try {
        await dataStore.refresh();
        showToast('Data refreshed successfully', 'success');

        // Re-render current view
        router.handleRoute();
    } catch (error) {
        console.error('Refresh failed:', error);
        showToast('Failed to refresh data', 'error');
    } finally {
        refreshBtn.classList.remove('loading');
    }
}

/**
 * Update refresh button state
 * @param {boolean} loading - Whether data is loading
 */
export function setRefreshLoading(loading) {
    const refreshBtn = document.getElementById('refresh-data-btn');
    if (refreshBtn) {
        refreshBtn.classList.toggle('loading', loading);
    }
}
