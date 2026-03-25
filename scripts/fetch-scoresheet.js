#!/usr/bin/env node

/**
 * Fetch Scoresheet roster data and save as JSON for the NPL web app.
 * Uses only built-in Node.js modules (no dependencies).
 *
 * Usage: node scripts/fetch-scoresheet.js
 * Output: data/scoresheet_rosters.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SS_ROSTER_URL = 'https://www.scoresheet.com/FOR_WWW1/BL_National_Pastime.js';
const SS_PLAYERS_URL_TEMPLATE = 'https://www.scoresheet.com/FOR_WWW/BL_Players_{YEAR}.tsv';

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} for ${url}`));
                res.resume();
                return;
            }
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

/**
 * Parse the Scoresheet JS file into structured data.
 * Dynamically extracts the year instead of hardcoding it.
 */
function parseScoresheetJS(rawText) {
    // Extract year dynamically
    const yearMatch = rawText.match(/pn_year_=(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

    // Extract round
    const roundMatch = rawText.match(/round1_=(\d+)/);
    const round = roundMatch ? parseInt(roundMatch[1]) : null;

    // Strip the prefix: everything up to and including "lg_ = "
    let json = rawText.replace(/^[\s\S]*?lg_\s*=\s*/, '');

    // Strip the suffix: semicolon and any trailing JS assignments
    json = json.replace(/;\s*Tjs_ok_q_\s*=\s*true\s*;?\s*$/, '');
    json = json.replace(/;\s*$/, '');

    // Remove newlines
    json = json.replace(/\n/g, '');

    // Quote unquoted keys
    json = json.replace(/(^|[{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

    // Convert single-quoted string values to double-quoted (e.g., 'BL' -> "BL")
    // Don't blindly replace all single quotes — apostrophes inside double-quoted
    // strings (like O'Hoppe) must be preserved.
    json = json.replace(/:(\s*)'([^']*)'/g, ':$1"$2"');

    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
        throw new Error(`Failed to parse Scoresheet JSON: ${e.message}\nFirst 500 chars: ${json.substring(0, 500)}`);
    }

    if (!parsed.rosters || !Array.isArray(parsed.rosters)) {
        throw new Error('Parsed data missing "rosters" array');
    }

    // Use owner_names as team identifiers (Scoresheet doesn't include team names)
    const ownerNames = parsed.owner_names || [];
    if (ownerNames.length !== parsed.rosters.length) {
        console.warn(`Warning: owner_names (${ownerNames.length}) and rosters (${parsed.rosters.length}) array lengths differ`);
    }

    // Build flat roster list
    const rosters = [];
    const teams = [];
    for (let i = 0; i < parsed.rosters.length; i++) {
        const ownerName = ownerNames[i] || `Team ${i + 1}`;
        teams.push(ownerName);
        const pins = parsed.rosters[i].pins || [];
        for (const pin of pins) {
            rosters.push({
                ssTeam: ownerName,
                pin: parseInt(pin),
            });
        }
    }

    return { year, round, teams, rosters };
}

/**
 * Parse the Scoresheet players TSV into a Map keyed by SSBB.
 */
function parseTSV(tsvText) {
    const lines = tsvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length === 0) return new Map();

    const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
    const players = new Map();

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = lines[i].split('\t');
        const row = {};
        for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = (cols[j] || '').trim();
        }
        const ssbb = parseInt(row.ssbb);
        if (!isNaN(ssbb)) {
            players.set(ssbb, {
                ssbb,
                mlbam: parseInt(row.mlbam) || null,
                firstName: row.firstname || '',
                lastName: row.lastname || '',
                pos: row.pos || '',
                h: row.h || '',
                age: parseInt(row.age) || null,
            });
        }
    }

    return players;
}

async function main() {
    console.log('Fetching Scoresheet roster data...');

    // Fetch and parse the roster JS file
    const jsText = await httpsGet(SS_ROSTER_URL);
    console.log(`  Downloaded BL_National_Pastime.js (${jsText.length} bytes)`);

    const { year, round, teams, rosters } = parseScoresheetJS(jsText);
    console.log(`  Year: ${year}, Round: ${round}, Teams: ${teams.length}, Roster entries: ${rosters.length}`);

    // Fetch player details TSV
    const playersUrl = SS_PLAYERS_URL_TEMPLATE.replace('{YEAR}', year);
    console.log(`  Fetching ${playersUrl}...`);
    const tsvText = await httpsGet(playersUrl);
    const playerMap = parseTSV(tsvText);
    console.log(`  Loaded ${playerMap.size} players from TSV`);

    // Join roster entries with player details
    const enrichedRosters = rosters.map(entry => {
        const player = playerMap.get(entry.pin);
        if (player) {
            return { ...entry, ...player };
        }
        return { ...entry, mlbam: null, firstName: '', lastName: '', pos: '', h: '', age: null };
    });

    const unmatched = enrichedRosters.filter(r => !r.mlbam);
    if (unmatched.length > 0) {
        console.warn(`  Warning: ${unmatched.length} roster entries have no MLBAM match`);
    }

    // Build output
    const output = {
        year,
        round,
        fetchedAt: new Date().toISOString(),
        teams,
        rosters: enrichedRosters,
    };

    // Write to data directory
    const outPath = path.join(__dirname, '..', 'data', 'scoresheet_rosters.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\nSaved to ${outPath}`);
    console.log(`  ${enrichedRosters.length} total roster entries across ${teams.length} teams`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
