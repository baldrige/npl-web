/**
 * Map View - Player Birthplace Mapping
 */

import { dataStore, NPL_TEAMS } from '../api/sheets.js';
import { sessionCache } from '../api/cache.js';

const MLB_STATS_API = 'https://statsapi.mlb.com/api/v1';

// Cache for team birthplace data (persists across team switches)
const teamBirthplaceCache = {};

// Geocoding cache
const geocodeCache = {};

// Counter to detect stale updates when user switches teams mid-load
let currentUpdateId = 0;

/**
 * Batch-fetch player info for multiple MLB IDs in a single API call
 * @param {string[]} mlbIds - Array of MLB player IDs
 * @returns {Promise<Object>} Map of mlbId -> player info
 */
async function fetchBatchPlayerInfo(mlbIds) {
    if (mlbIds.length === 0) return {};

    const results = {};
    // MLB API supports up to ~150 IDs per request
    const batchSize = 100;

    for (let i = 0; i < mlbIds.length; i += batchSize) {
        const batch = mlbIds.slice(i, i + batchSize);
        const ids = batch.join(',');
        try {
            const resp = await fetch(`${MLB_STATS_API}/people?personIds=${ids}`);
            if (!resp.ok) continue;
            const data = await resp.json();
            for (const person of (data.people || [])) {
                results[String(person.id)] = {
                    birthCity: person.birthCity,
                    birthStateProvince: person.birthStateProvince,
                    birthCountry: person.birthCountry,
                };
            }
        } catch (e) {
            console.error('Batch player info fetch error:', e);
        }
    }

    return results;
}

/**
 * Render the map view
 * @param {Object} params - Route parameters
 * @returns {HTMLElement} View element
 */
export async function renderMap(params = {}) {
    // Ensure data is loaded
    if (!dataStore.isLoaded) {
        await dataStore.loadAll();
    }

    const container = document.createElement('div');
    container.className = 'map-view';

    // Get initial team from params or default to Bulldog
    const bulldogTeam = NPL_TEAMS.find(t => t.name === 'Bulldog');
    const initialTeamId = params.team || (bulldogTeam ? bulldogTeam.id : NPL_TEAMS[0].id);

    container.innerHTML = `
        <div class="view-header">
            <h1>Player Birthplace Map</h1>
            <p>Geographic distribution of team rosters</p>
        </div>

        <div class="filters-bar">
            <div class="filter-group">
                <label>NPL Team</label>
                <select id="team-select" class="filter-select">
                    ${NPL_TEAMS.map(team => `
                        <option value="${team.id}" ${String(team.id) === String(initialTeamId) ? 'selected' : ''}>
                            ${team.name}
                        </option>
                    `).join('')}
                </select>
            </div>
            <div class="filter-group">
                <span id="map-status" class="text-muted text-sm">Loading player data...</span>
            </div>
        </div>

        <div class="map-container-wrapper">
            <div id="birthplace-map" class="birthplace-map"></div>
            <div id="map-stats" class="map-stats">
                <div class="map-stat-card">
                    <h4>Geographic Center</h4>
                    <div id="center-info" class="center-info">Calculating...</div>
                </div>
                <div class="map-stat-card">
                    <h4>Birthplace Breakdown</h4>
                    <div id="country-breakdown" class="country-breakdown">Loading...</div>
                </div>
            </div>
        </div>
    `;

    // Load Leaflet CSS and JS if not already loaded
    await loadLeaflet();

    // Initialize map
    const mapEl = container.querySelector('#birthplace-map');
    const map = L.map(mapEl).setView([39.8283, -98.5795], 4); // Center of USA

    // Add tile layer (OpenStreetMap)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Create a single layer group for all markers
    const markersLayer = L.layerGroup().addTo(map);
    let centerMarker = null;

    // Team selector
    const teamSelect = container.querySelector('#team-select');
    let currentTeamId = initialTeamId;

    /**
     * Update the map with team birthplaces
     */
    async function updateMap() {
        const myUpdateId = ++currentUpdateId;
        const statusEl = container.querySelector('#map-status');
        const centerInfoEl = container.querySelector('#center-info');
        const countryBreakdownEl = container.querySelector('#country-breakdown');

        // Clear ALL existing markers first
        markersLayer.clearLayers();
        if (centerMarker) {
            map.removeLayer(centerMarker);
            centerMarker = null;
        }

        const team = NPL_TEAMS.find(t => String(t.id) === String(currentTeamId));
        const cacheKey = `team_birthplaces_${currentTeamId}`;

        // Check if we have cached data for this team
        if (teamBirthplaceCache[currentTeamId]) {
            displayBirthplaces(teamBirthplaceCache[currentTeamId].birthplaces, teamBirthplaceCache[currentTeamId].countryCount, team);
            return;
        }

        // Also check session cache
        const sessionCached = sessionCache.get(cacheKey);
        if (sessionCached) {
            teamBirthplaceCache[currentTeamId] = sessionCached;
            displayBirthplaces(sessionCached.birthplaces, sessionCached.countryCount, team);
            return;
        }

        statusEl.textContent = 'Loading player birthplaces...';
        centerInfoEl.textContent = 'Calculating...';
        countryBreakdownEl.innerHTML = '<span class="text-muted">Loading...</span>';

        try {
            // Get team roster
            const roster = dataStore.getTeamRoster(currentTeamId);

            if (roster.length === 0) {
                statusEl.textContent = 'No players on roster';
                centerInfoEl.textContent = 'No data';
                countryBreakdownEl.innerHTML = '<span class="text-muted">No players</span>';
                return;
            }

            // Batch-fetch all player info in one API call
            const mlbIds = roster.map(p => p.mlbId).filter(Boolean);
            statusEl.textContent = `Fetching info for ${mlbIds.length} players...`;
            const infoMap = await fetchBatchPlayerInfo(mlbIds);

            // Abort if user switched teams during fetch
            if (myUpdateId !== currentUpdateId) return;

            // Geocode all birthplaces
            const birthplaces = [];
            const countryCount = {};
            let geocoded = 0;
            const playersWithInfo = roster.filter(p => p.mlbId && infoMap[p.mlbId]?.birthCity);

            for (const player of playersWithInfo) {
                const info = infoMap[player.mlbId];
                const location = `${info.birthCity}, ${info.birthStateProvince || ''} ${info.birthCountry || ''}`.trim();
                const coords = geocodeLocation(location, info);

                // Abort if user switched teams during geocoding
                if (myUpdateId !== currentUpdateId) return;

                geocoded++;
                statusEl.textContent = `Geocoding birthplaces... ${geocoded}/${playersWithInfo.length}`;

                if (coords) {
                    birthplaces.push({
                        player: player.name,
                        mlbId: player.mlbId,
                        location: location,
                        city: info.birthCity,
                        state: info.birthStateProvince,
                        country: info.birthCountry || 'USA',
                        lat: coords.lat,
                        lng: coords.lng
                    });

                    const country = info.birthCountry || 'USA';
                    countryCount[country] = (countryCount[country] || 0) + 1;
                }
            }

            // Cache the results
            const cacheData = { birthplaces, countryCount };
            teamBirthplaceCache[currentTeamId] = cacheData;
            sessionCache.set(cacheKey, cacheData, 60 * 60 * 1000);

            // Display the results
            displayBirthplaces(birthplaces, countryCount, team);
        } catch (error) {
            console.error('Error updating map:', error);
            statusEl.textContent = 'Error loading birthplaces';
        }
    }

    /**
     * Display birthplaces on the map
     */
    function displayBirthplaces(birthplaces, countryCount, team) {
        const statusEl = container.querySelector('#map-status');
        const centerInfoEl = container.querySelector('#center-info');
        const countryBreakdownEl = container.querySelector('#country-breakdown');

        // Clear markers again to be safe
        markersLayer.clearLayers();
        if (centerMarker) {
            map.removeLayer(centerMarker);
            centerMarker = null;
        }

        if (birthplaces.length === 0) {
            statusEl.textContent = 'No birthplace data available';
            centerInfoEl.textContent = 'No data';
            countryBreakdownEl.innerHTML = '<span class="text-muted">No data</span>';
            return;
        }

        // Add markers for each birthplace
        for (const bp of birthplaces) {
            const marker = L.circleMarker([bp.lat, bp.lng], {
                radius: 8,
                fillColor: '#1a365d',
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            });
            marker.bindPopup(`<strong>${bp.player}</strong><br>${bp.city}, ${bp.state || ''}<br>${bp.country}`);
            markersLayer.addLayer(marker);
        }

        // Calculate and show geographic center
        const center = calculateGeographicCenter(birthplaces);

        // Add center marker
        centerMarker = L.marker([center.lat, center.lng], {
            icon: L.divIcon({
                className: 'center-marker',
                html: '<div class="center-marker-inner"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        });
        centerMarker.bindPopup(`<strong>Geographic Center</strong><br>${team.name} Roster<br>Lat: ${center.lat.toFixed(4)}, Lng: ${center.lng.toFixed(4)}`);
        centerMarker.addTo(map);

        // Fit map to show all markers
        if (birthplaces.length > 1) {
            const bounds = L.latLngBounds(birthplaces.map(p => [p.lat, p.lng]));
            bounds.extend([center.lat, center.lng]);
            map.fitBounds(bounds, { padding: [50, 50] });
        } else if (birthplaces.length === 1) {
            map.setView([center.lat, center.lng], 6);
        }

        // Update center info
        centerInfoEl.innerHTML = `
            <div class="center-coords">
                <strong>Geographic Center</strong>
            </div>
            <div class="center-details text-sm text-muted">
                Lat: ${center.lat.toFixed(4)}, Lng: ${center.lng.toFixed(4)}
            </div>
        `;

        // Update country breakdown
        const sortedCountries = Object.entries(countryCount)
            .sort((a, b) => b[1] - a[1]);

        countryBreakdownEl.innerHTML = sortedCountries.map(([country, count]) => `
            <div class="country-row">
                <span class="country-name">${country}</span>
                <span class="country-count">${count}</span>
            </div>
        `).join('') || '<span class="text-muted">No data</span>';

        statusEl.textContent = `Showing ${birthplaces.length} players`;
    }

    // Team selector event
    teamSelect.addEventListener('change', (e) => {
        currentTeamId = e.target.value;
        history.replaceState(null, '', `#/map?team=${currentTeamId}`);
        updateMap();
    });

    // Initial load - delay to ensure map container is rendered
    setTimeout(() => {
        map.invalidateSize();
        updateMap();
    }, 100);

    return container;
}

/**
 * Load Leaflet library dynamically
 */
async function loadLeaflet() {
    if (window.L) return; // Already loaded

    // Load CSS
    const cssLink = document.createElement('link');
    cssLink.rel = 'stylesheet';
    cssLink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(cssLink);

    // Load JS
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

/**
 * Geocode a location to lat/lng using static lookups (no external API)
 */
function geocodeLocation(locationString, playerInfo) {
    const cacheKey = `geo_${locationString}`;
    if (geocodeCache[cacheKey]) {
        return geocodeCache[cacheKey];
    }

    // Try known city coordinates first
    const knownLocation = getKnownLocation(playerInfo);
    if (knownLocation) {
        geocodeCache[cacheKey] = knownLocation;
        return knownLocation;
    }

    // Fall back to US state center or country center
    const fallback = getStateFallback(playerInfo) || getCountryFallback(playerInfo);
    if (fallback) {
        geocodeCache[cacheKey] = fallback;
        return fallback;
    }

    return null;
}

/**
 * US state center coordinates (fallback when city isn't in known list)
 */
const US_STATES = {
    'al': { lat: 32.806671, lng: -86.791130 }, 'ak': { lat: 61.370716, lng: -152.404419 },
    'az': { lat: 33.729759, lng: -111.431221 }, 'ar': { lat: 34.969704, lng: -92.373123 },
    'ca': { lat: 36.116203, lng: -119.681564 }, 'co': { lat: 39.059811, lng: -105.311104 },
    'ct': { lat: 41.597782, lng: -72.755371 }, 'de': { lat: 39.318523, lng: -75.507141 },
    'fl': { lat: 27.766279, lng: -81.686783 }, 'ga': { lat: 33.040619, lng: -83.643074 },
    'hi': { lat: 21.094318, lng: -157.498337 }, 'id': { lat: 44.240459, lng: -114.478828 },
    'il': { lat: 40.349457, lng: -88.986137 }, 'in': { lat: 39.849426, lng: -86.258278 },
    'ia': { lat: 42.011539, lng: -93.210526 }, 'ks': { lat: 38.526600, lng: -96.726486 },
    'ky': { lat: 37.668140, lng: -84.670067 }, 'la': { lat: 31.169546, lng: -91.867805 },
    'me': { lat: 44.693947, lng: -69.381927 }, 'md': { lat: 39.063946, lng: -76.802101 },
    'ma': { lat: 42.230171, lng: -71.530106 }, 'mi': { lat: 43.326618, lng: -84.536095 },
    'mn': { lat: 45.694454, lng: -93.900192 }, 'ms': { lat: 32.741646, lng: -89.678696 },
    'mo': { lat: 38.456085, lng: -92.288368 }, 'mt': { lat: 46.921925, lng: -110.454353 },
    'ne': { lat: 41.125370, lng: -98.268082 }, 'nv': { lat: 38.313515, lng: -117.055374 },
    'nh': { lat: 43.452492, lng: -71.563896 }, 'nj': { lat: 40.298904, lng: -74.521011 },
    'nm': { lat: 34.840515, lng: -106.248482 }, 'ny': { lat: 42.165726, lng: -74.948051 },
    'nc': { lat: 35.630066, lng: -79.806419 }, 'nd': { lat: 47.528912, lng: -99.784012 },
    'oh': { lat: 40.388783, lng: -82.764915 }, 'ok': { lat: 35.565342, lng: -96.928917 },
    'or': { lat: 44.572021, lng: -122.070938 }, 'pa': { lat: 40.590752, lng: -77.209755 },
    'ri': { lat: 41.680893, lng: -71.511780 }, 'sc': { lat: 33.856892, lng: -80.945007 },
    'sd': { lat: 44.299782, lng: -99.438828 }, 'tn': { lat: 35.747845, lng: -86.692345 },
    'tx': { lat: 31.054487, lng: -97.563461 }, 'ut': { lat: 40.150032, lng: -111.862434 },
    'vt': { lat: 44.045876, lng: -72.710686 }, 'va': { lat: 37.769337, lng: -78.169968 },
    'wa': { lat: 47.400902, lng: -121.490494 }, 'wv': { lat: 38.491226, lng: -80.954456 },
    'wi': { lat: 44.268543, lng: -89.616508 }, 'wy': { lat: 42.755966, lng: -107.302490 },
    'dc': { lat: 38.9072, lng: -77.0369 },
    // Common full-name lookups
    'alabama': { lat: 32.806671, lng: -86.791130 }, 'alaska': { lat: 61.370716, lng: -152.404419 },
    'arizona': { lat: 33.729759, lng: -111.431221 }, 'arkansas': { lat: 34.969704, lng: -92.373123 },
    'california': { lat: 36.116203, lng: -119.681564 }, 'colorado': { lat: 39.059811, lng: -105.311104 },
    'connecticut': { lat: 41.597782, lng: -72.755371 }, 'delaware': { lat: 39.318523, lng: -75.507141 },
    'florida': { lat: 27.766279, lng: -81.686783 }, 'georgia': { lat: 33.040619, lng: -83.643074 },
    'hawaii': { lat: 21.094318, lng: -157.498337 }, 'idaho': { lat: 44.240459, lng: -114.478828 },
    'illinois': { lat: 40.349457, lng: -88.986137 }, 'indiana': { lat: 39.849426, lng: -86.258278 },
    'iowa': { lat: 42.011539, lng: -93.210526 }, 'kansas': { lat: 38.526600, lng: -96.726486 },
    'kentucky': { lat: 37.668140, lng: -84.670067 }, 'louisiana': { lat: 31.169546, lng: -91.867805 },
    'maine': { lat: 44.693947, lng: -69.381927 }, 'maryland': { lat: 39.063946, lng: -76.802101 },
    'massachusetts': { lat: 42.230171, lng: -71.530106 }, 'michigan': { lat: 43.326618, lng: -84.536095 },
    'minnesota': { lat: 45.694454, lng: -93.900192 }, 'mississippi': { lat: 32.741646, lng: -89.678696 },
    'missouri': { lat: 38.456085, lng: -92.288368 }, 'montana': { lat: 46.921925, lng: -110.454353 },
    'nebraska': { lat: 41.125370, lng: -98.268082 }, 'nevada': { lat: 38.313515, lng: -117.055374 },
    'new hampshire': { lat: 43.452492, lng: -71.563896 }, 'new jersey': { lat: 40.298904, lng: -74.521011 },
    'new mexico': { lat: 34.840515, lng: -106.248482 }, 'new york': { lat: 42.165726, lng: -74.948051 },
    'north carolina': { lat: 35.630066, lng: -79.806419 }, 'north dakota': { lat: 47.528912, lng: -99.784012 },
    'ohio': { lat: 40.388783, lng: -82.764915 }, 'oklahoma': { lat: 35.565342, lng: -96.928917 },
    'oregon': { lat: 44.572021, lng: -122.070938 }, 'pennsylvania': { lat: 40.590752, lng: -77.209755 },
    'rhode island': { lat: 41.680893, lng: -71.511780 }, 'south carolina': { lat: 33.856892, lng: -80.945007 },
    'south dakota': { lat: 44.299782, lng: -99.438828 }, 'tennessee': { lat: 35.747845, lng: -86.692345 },
    'texas': { lat: 31.054487, lng: -97.563461 }, 'utah': { lat: 40.150032, lng: -111.862434 },
    'vermont': { lat: 44.045876, lng: -72.710686 }, 'virginia': { lat: 37.769337, lng: -78.169968 },
    'washington': { lat: 47.400902, lng: -121.490494 }, 'west virginia': { lat: 38.491226, lng: -80.954456 },
    'wisconsin': { lat: 44.268543, lng: -89.616508 }, 'wyoming': { lat: 42.755966, lng: -107.302490 },
    'puerto rico': { lat: 18.2208, lng: -66.5901 },
};

/**
 * Country center coordinates
 */
const COUNTRY_COORDS = {
    'usa': { lat: 39.8283, lng: -98.5795 },
    'united states': { lat: 39.8283, lng: -98.5795 },
    'dominican republic': { lat: 18.7357, lng: -70.1627 },
    'venezuela': { lat: 8.0, lng: -66.0 },
    'cuba': { lat: 21.5218, lng: -77.7812 },
    'mexico': { lat: 23.6345, lng: -102.5528 },
    'méxico': { lat: 23.6345, lng: -102.5528 },
    'puerto rico': { lat: 18.2208, lng: -66.5901 },
    'canada': { lat: 56.1304, lng: -106.3468 },
    'japan': { lat: 36.2048, lng: 138.2529 },
    'south korea': { lat: 35.9078, lng: 127.7669 },
    'korea': { lat: 35.9078, lng: 127.7669 },
    'taiwan': { lat: 23.6978, lng: 120.9605 },
    'australia': { lat: -25.2744, lng: 133.7751 },
    'colombia': { lat: 4.5709, lng: -74.2973 },
    'panama': { lat: 8.5380, lng: -80.7821 },
    'panamá': { lat: 8.5380, lng: -80.7821 },
    'nicaragua': { lat: 12.8654, lng: -85.2072 },
    'curacao': { lat: 12.1696, lng: -68.9900 },
    'curaçao': { lat: 12.1696, lng: -68.9900 },
    'aruba': { lat: 12.5211, lng: -69.9683 },
    'brazil': { lat: -14.2350, lng: -51.9253 },
    'germany': { lat: 51.1657, lng: 10.4515 },
    'netherlands': { lat: 52.1326, lng: 5.2913 },
    'bahamas': { lat: 25.0343, lng: -77.3963 },
    'honduras': { lat: 15.2, lng: -86.2419 },
};

function getStateFallback(info) {
    if (!info) return null;
    const state = (info.birthStateProvince || '').toLowerCase().trim();
    return US_STATES[state] || null;
}

function getCountryFallback(info) {
    if (!info) return null;
    const country = (info.birthCountry || '').toLowerCase().trim();
    return COUNTRY_COORDS[country] || null;
}

/**
 * Get coordinates for known baseball locations
 */
function getKnownLocation(info) {
    if (!info) return null;

    const city = info.birthCity?.toLowerCase().trim();
    const state = info.birthStateProvince?.toLowerCase().trim();
    const country = info.birthCountry?.toLowerCase().trim();

    // US State capitals and major cities
    const usaCities = {
        'los angeles': { lat: 34.0522, lng: -118.2437 },
        'new york': { lat: 40.7128, lng: -74.0060 },
        'chicago': { lat: 41.8781, lng: -87.6298 },
        'houston': { lat: 29.7604, lng: -95.3698 },
        'phoenix': { lat: 33.4484, lng: -112.0740 },
        'philadelphia': { lat: 39.9526, lng: -75.1652 },
        'san antonio': { lat: 29.4241, lng: -98.4936 },
        'san diego': { lat: 32.7157, lng: -117.1611 },
        'dallas': { lat: 32.7767, lng: -96.7970 },
        'san jose': { lat: 37.3382, lng: -121.8863 },
        'austin': { lat: 30.2672, lng: -97.7431 },
        'jacksonville': { lat: 30.3322, lng: -81.6557 },
        'san francisco': { lat: 37.7749, lng: -122.4194 },
        'columbus': { lat: 39.9612, lng: -82.9988 },
        'indianapolis': { lat: 39.7684, lng: -86.1581 },
        'fort worth': { lat: 32.7555, lng: -97.3308 },
        'charlotte': { lat: 35.2271, lng: -80.8431 },
        'seattle': { lat: 47.6062, lng: -122.3321 },
        'denver': { lat: 39.7392, lng: -104.9903 },
        'washington': { lat: 38.9072, lng: -77.0369 },
        'boston': { lat: 42.3601, lng: -71.0589 },
        'el paso': { lat: 31.7619, lng: -106.4850 },
        'nashville': { lat: 36.1627, lng: -86.7816 },
        'detroit': { lat: 42.3314, lng: -83.0458 },
        'oklahoma city': { lat: 35.4676, lng: -97.5164 },
        'portland': { lat: 45.5152, lng: -122.6784 },
        'las vegas': { lat: 36.1699, lng: -115.1398 },
        'memphis': { lat: 35.1495, lng: -90.0490 },
        'louisville': { lat: 38.2527, lng: -85.7585 },
        'baltimore': { lat: 39.2904, lng: -76.6122 },
        'milwaukee': { lat: 43.0389, lng: -87.9065 },
        'albuquerque': { lat: 35.0844, lng: -106.6504 },
        'tucson': { lat: 32.2226, lng: -110.9747 },
        'fresno': { lat: 36.7378, lng: -119.7871 },
        'sacramento': { lat: 38.5816, lng: -121.4944 },
        'kansas city': { lat: 39.0997, lng: -94.5786 },
        'mesa': { lat: 33.4152, lng: -111.8315 },
        'atlanta': { lat: 33.7490, lng: -84.3880 },
        'omaha': { lat: 41.2565, lng: -95.9345 },
        'miami': { lat: 25.7617, lng: -80.1918 },
        'oakland': { lat: 37.8044, lng: -122.2712 },
        'minneapolis': { lat: 44.9778, lng: -93.2650 },
        'tulsa': { lat: 36.1540, lng: -95.9928 },
        'cleveland': { lat: 41.4993, lng: -81.6944 },
        'wichita': { lat: 37.6872, lng: -97.3301 },
        'arlington': { lat: 32.7357, lng: -97.1081 },
        'new orleans': { lat: 29.9511, lng: -90.0715 },
        'bakersfield': { lat: 35.3733, lng: -119.0187 },
        'tampa': { lat: 27.9506, lng: -82.4572 },
        'honolulu': { lat: 21.3069, lng: -157.8583 },
        'anaheim': { lat: 33.8366, lng: -117.9143 },
        'aurora': { lat: 39.7294, lng: -104.8319 },
        'santa ana': { lat: 33.7455, lng: -117.8677 },
        'st. louis': { lat: 38.6270, lng: -90.1994 },
        'saint louis': { lat: 38.6270, lng: -90.1994 },
        'riverside': { lat: 33.9806, lng: -117.3755 },
        'corpus christi': { lat: 27.8006, lng: -97.3964 },
        'pittsburgh': { lat: 40.4406, lng: -79.9959 },
        'lexington': { lat: 38.0406, lng: -84.5037 },
        'anchorage': { lat: 61.2181, lng: -149.9003 },
        'stockton': { lat: 37.9577, lng: -121.2908 },
        'cincinnati': { lat: 39.1031, lng: -84.5120 },
        'st. paul': { lat: 44.9537, lng: -93.0900 },
        'toledo': { lat: 41.6528, lng: -83.5379 },
        'newark': { lat: 40.7357, lng: -74.1724 },
        'greensboro': { lat: 36.0726, lng: -79.7920 },
        'plano': { lat: 33.0198, lng: -96.6989 },
        'henderson': { lat: 36.0395, lng: -114.9817 },
        'lincoln': { lat: 40.8258, lng: -96.6852 },
        'buffalo': { lat: 42.8864, lng: -78.8784 },
        'fort wayne': { lat: 41.0793, lng: -85.1394 },
        'jersey city': { lat: 40.7178, lng: -74.0431 },
        'chula vista': { lat: 32.6401, lng: -117.0842 },
        'orlando': { lat: 28.5383, lng: -81.3792 },
        'st. petersburg': { lat: 27.7676, lng: -82.6403 },
        'norfolk': { lat: 36.8508, lng: -76.2859 },
        'chandler': { lat: 33.3062, lng: -111.8413 },
        'laredo': { lat: 27.5306, lng: -99.4803 },
        'madison': { lat: 43.0731, lng: -89.4012 },
        'durham': { lat: 35.9940, lng: -78.8986 },
        'lubbock': { lat: 33.5779, lng: -101.8552 },
        'winston-salem': { lat: 36.0999, lng: -80.2442 },
        'garland': { lat: 32.9126, lng: -96.6389 },
        'glendale': { lat: 33.5387, lng: -112.1860 },
        'hialeah': { lat: 25.8576, lng: -80.2781 },
        'reno': { lat: 39.5296, lng: -119.8138 },
        'baton rouge': { lat: 30.4515, lng: -91.1871 },
        'irvine': { lat: 33.6846, lng: -117.8265 },
        'chesapeake': { lat: 36.7682, lng: -76.2875 },
        'irving': { lat: 32.8140, lng: -96.9489 },
        'scottsdale': { lat: 33.4942, lng: -111.9261 },
        'north las vegas': { lat: 36.1989, lng: -115.1175 },
        'fremont': { lat: 37.5485, lng: -121.9886 },
        'gilbert': { lat: 33.3528, lng: -111.7890 },
        'san bernardino': { lat: 34.1083, lng: -117.2898 },
        'boise': { lat: 43.6150, lng: -116.2023 },
        'birmingham': { lat: 33.5207, lng: -86.8025 },
    };

    // Dominican Republic cities
    const drCities = {
        'santo domingo': { lat: 18.4861, lng: -69.9312 },
        'san pedro de macoris': { lat: 18.4539, lng: -69.3086 },
        'san pedro de macorís': { lat: 18.4539, lng: -69.3086 },
        'santiago': { lat: 19.4517, lng: -70.6970 },
        'santiago de los caballeros': { lat: 19.4517, lng: -70.6970 },
        'la romana': { lat: 18.4273, lng: -68.9728 },
        'san cristobal': { lat: 18.4167, lng: -70.1000 },
        'san cristóbal': { lat: 18.4167, lng: -70.1000 },
        'puerto plata': { lat: 19.7934, lng: -70.6884 },
        'la vega': { lat: 19.2220, lng: -70.5296 },
        'san francisco de macoris': { lat: 19.3008, lng: -70.2527 },
        'san francisco de macorís': { lat: 19.3008, lng: -70.2527 },
        'higuey': { lat: 18.6167, lng: -68.7000 },
        'higüey': { lat: 18.6167, lng: -68.7000 },
        'bani': { lat: 18.2833, lng: -70.3333 },
        'baní': { lat: 18.2833, lng: -70.3333 },
        'azua': { lat: 18.4531, lng: -70.7289 },
        'moca': { lat: 19.3833, lng: -70.5167 },
        'bonao': { lat: 18.9333, lng: -70.4167 },
        'cotui': { lat: 19.0500, lng: -70.1500 },
        'cotuí': { lat: 19.0500, lng: -70.1500 },
        'nagua': { lat: 19.3833, lng: -69.8500 },
        'samana': { lat: 19.2000, lng: -69.3333 },
        'samaná': { lat: 19.2000, lng: -69.3333 },
        'monte cristi': { lat: 19.8500, lng: -71.6500 },
        'barahona': { lat: 18.2000, lng: -71.1000 },
    };

    // Venezuelan cities
    const vzCities = {
        'caracas': { lat: 10.4806, lng: -66.9036 },
        'maracaibo': { lat: 10.6544, lng: -71.6370 },
        'valencia': { lat: 10.1620, lng: -67.9993 },
        'barquisimeto': { lat: 10.0678, lng: -69.3474 },
        'maracay': { lat: 10.2469, lng: -67.5958 },
        'ciudad guayana': { lat: 8.3700, lng: -62.6500 },
        'barcelona': { lat: 10.1167, lng: -64.7000 },
        'maturin': { lat: 9.7500, lng: -63.1833 },
        'maturín': { lat: 9.7500, lng: -63.1833 },
        'puerto la cruz': { lat: 10.2167, lng: -64.6333 },
        'cumana': { lat: 10.4500, lng: -64.1833 },
        'cumaná': { lat: 10.4500, lng: -64.1833 },
        'barinas': { lat: 8.6226, lng: -70.2074 },
        'cabimas': { lat: 10.3833, lng: -71.4333 },
        'merida': { lat: 8.5833, lng: -71.1500 },
        'mérida': { lat: 8.5833, lng: -71.1500 },
        'san cristobal': { lat: 7.7667, lng: -72.2333 },
        'san cristóbal': { lat: 7.7667, lng: -72.2333 },
        'aragua de barcelona': { lat: 9.4500, lng: -64.8333 },
        'carabobo': { lat: 10.1620, lng: -67.9993 },
        'puerto cabello': { lat: 10.4667, lng: -68.0167 },
    };

    // Cuban cities
    const cubaCities = {
        'havana': { lat: 23.1136, lng: -82.3666 },
        'la habana': { lat: 23.1136, lng: -82.3666 },
        'santiago de cuba': { lat: 20.0247, lng: -75.8219 },
        'camaguey': { lat: 21.3809, lng: -77.9170 },
        'camagüey': { lat: 21.3809, lng: -77.9170 },
        'holguin': { lat: 20.7833, lng: -76.2667 },
        'holguín': { lat: 20.7833, lng: -76.2667 },
        'santa clara': { lat: 22.4000, lng: -79.9500 },
        'guantanamo': { lat: 20.1500, lng: -75.2167 },
        'guantánamo': { lat: 20.1500, lng: -75.2167 },
        'bayamo': { lat: 20.3833, lng: -76.6500 },
        'cienfuegos': { lat: 22.1500, lng: -80.4500 },
        'pinar del rio': { lat: 22.4167, lng: -83.7000 },
        'pinar del río': { lat: 22.4167, lng: -83.7000 },
        'las tunas': { lat: 20.9500, lng: -76.9500 },
        'matanzas': { lat: 23.0500, lng: -81.5833 },
        'sancti spiritus': { lat: 21.9333, lng: -79.4333 },
        'sancti spíritus': { lat: 21.9333, lng: -79.4333 },
        'ciego de avila': { lat: 21.8333, lng: -78.7500 },
        'ciego de ávila': { lat: 21.8333, lng: -78.7500 },
    };

    // Puerto Rican cities
    const prCities = {
        'san juan': { lat: 18.4655, lng: -66.1057 },
        'bayamon': { lat: 18.3994, lng: -66.1553 },
        'bayamón': { lat: 18.3994, lng: -66.1553 },
        'carolina': { lat: 18.3808, lng: -65.9574 },
        'ponce': { lat: 18.0111, lng: -66.6141 },
        'caguas': { lat: 18.2341, lng: -66.0485 },
        'guaynabo': { lat: 18.3833, lng: -66.1000 },
        'mayaguez': { lat: 18.2013, lng: -67.1397 },
        'mayagüez': { lat: 18.2013, lng: -67.1397 },
        'arecibo': { lat: 18.4500, lng: -66.7167 },
        'aguadilla': { lat: 18.4275, lng: -67.1541 },
        'fajardo': { lat: 18.3333, lng: -65.6500 },
        'humacao': { lat: 18.1500, lng: -65.8167 },
        'manati': { lat: 18.4333, lng: -66.4833 },
        'manatí': { lat: 18.4333, lng: -66.4833 },
        'guayama': { lat: 17.9833, lng: -66.1167 },
        'yauco': { lat: 18.0333, lng: -66.8500 },
        'cabo rojo': { lat: 18.0833, lng: -67.1500 },
        'toa baja': { lat: 18.4500, lng: -66.2500 },
        'catano': { lat: 18.4333, lng: -66.1167 },
        'cataño': { lat: 18.4333, lng: -66.1167 },
    };

    // Mexican cities
    const mxCities = {
        'mexico city': { lat: 19.4326, lng: -99.1332 },
        'ciudad de mexico': { lat: 19.4326, lng: -99.1332 },
        'guadalajara': { lat: 20.6597, lng: -103.3496 },
        'monterrey': { lat: 25.6866, lng: -100.3161 },
        'tijuana': { lat: 32.5149, lng: -117.0382 },
        'hermosillo': { lat: 29.0729, lng: -110.9559 },
        'culiacan': { lat: 24.8091, lng: -107.3940 },
        'culiacán': { lat: 24.8091, lng: -107.3940 },
        'mexicali': { lat: 32.6245, lng: -115.4523 },
        'ciudad juarez': { lat: 31.6904, lng: -106.4245 },
        'ciudad juárez': { lat: 31.6904, lng: -106.4245 },
        'cancun': { lat: 21.1619, lng: -86.8515 },
        'cancún': { lat: 21.1619, lng: -86.8515 },
        'merida': { lat: 20.9674, lng: -89.5926 },
        'mérida': { lat: 20.9674, lng: -89.5926 },
        'chihuahua': { lat: 28.6353, lng: -106.0889 },
        'puebla': { lat: 19.0414, lng: -98.2063 },
        'leon': { lat: 21.1250, lng: -101.6860 },
        'león': { lat: 21.1250, lng: -101.6860 },
        'obregon': { lat: 27.4861, lng: -109.9400 },
        'ciudad obregon': { lat: 27.4861, lng: -109.9400 },
        'ciudad obregón': { lat: 27.4861, lng: -109.9400 },
        'los mochis': { lat: 25.7908, lng: -108.9856 },
        'mazatlan': { lat: 23.2494, lng: -106.4111 },
        'mazatlán': { lat: 23.2494, lng: -106.4111 },
        'ensenada': { lat: 31.8667, lng: -116.5833 },
        'veracruz': { lat: 19.1738, lng: -96.1342 },
        'navojoa': { lat: 27.0667, lng: -109.4500 },
        'guasave': { lat: 25.5667, lng: -108.4667 },
    };

    // Japanese cities
    const jpCities = {
        'tokyo': { lat: 35.6762, lng: 139.6503 },
        'osaka': { lat: 34.6937, lng: 135.5023 },
        'kyoto': { lat: 35.0116, lng: 135.7681 },
        'yokohama': { lat: 35.4437, lng: 139.6380 },
        'nagoya': { lat: 35.1815, lng: 136.9066 },
        'sapporo': { lat: 43.0618, lng: 141.3545 },
        'kobe': { lat: 34.6901, lng: 135.1956 },
        'fukuoka': { lat: 33.5904, lng: 130.4017 },
        'hiroshima': { lat: 34.3853, lng: 132.4553 },
        'sendai': { lat: 38.2682, lng: 140.8694 },
    };

    // Determine which city list to use based on country
    if (city) {
        const countryLower = country || '';

        if (countryLower.includes('dominican') || countryLower === 'dr') {
            if (drCities[city]) return drCities[city];
        } else if (countryLower.includes('venezuela')) {
            if (vzCities[city]) return vzCities[city];
        } else if (countryLower.includes('cuba')) {
            if (cubaCities[city]) return cubaCities[city];
        } else if (countryLower.includes('puerto rico') || (state && state.includes('puerto rico'))) {
            if (prCities[city]) return prCities[city];
        } else if (countryLower.includes('mexico') || countryLower.includes('méxico')) {
            if (mxCities[city]) return mxCities[city];
        } else if (countryLower.includes('japan')) {
            if (jpCities[city]) return jpCities[city];
        } else if (!countryLower || countryLower === 'usa' || countryLower.includes('united states')) {
            if (usaCities[city]) return usaCities[city];
        }
    }

    return null;
}

/**
 * Calculate the geographic center (centroid) of a set of points
 */
function calculateGeographicCenter(points) {
    if (points.length === 0) return null;
    if (points.length === 1) return { lat: points[0].lat, lng: points[0].lng };

    // Convert to radians and calculate centroid using spherical coordinates
    let x = 0, y = 0, z = 0;

    for (const point of points) {
        const latRad = point.lat * Math.PI / 180;
        const lngRad = point.lng * Math.PI / 180;

        x += Math.cos(latRad) * Math.cos(lngRad);
        y += Math.cos(latRad) * Math.sin(lngRad);
        z += Math.sin(latRad);
    }

    const n = points.length;
    x /= n;
    y /= n;
    z /= n;

    const lngRad = Math.atan2(y, x);
    const hyp = Math.sqrt(x * x + y * y);
    const latRad = Math.atan2(z, hyp);

    return {
        lat: latRad * 180 / Math.PI,
        lng: lngRad * 180 / Math.PI
    };
}
