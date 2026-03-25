#!/usr/bin/env node

/**
 * Fetch Scoresheet roster data and save as JSON for the NPL web app.
 * Uses only built-in Node.js modules (no dependencies).
 *
 * Downloads two files from scoresheet.com:
 *   1. BL_National_Pastime.js   — base roster data (keeper pins per team)
 *   2. BL_National_Pastime-T.js — transactions (trades, draft picks, drops)
 * Then replays the transactions to build the full current rosters,
 * and enriches with player details from the TSV file.
 *
 * Usage: node scripts/fetch-scoresheet.js
 * Output: data/scoresheet_rosters.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SS_BASE_URL = 'https://www.scoresheet.com/FOR_WWW1/BL_National_Pastime';
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
 * Parse the Scoresheet base JS file into structured data.
 */
function parseScoresheetJS(rawText) {
    const yearMatch = rawText.match(/pn_year_=(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

    const roundMatch = rawText.match(/round1_=(\d+)/);
    const round = roundMatch ? parseInt(roundMatch[1]) : null;

    let json = rawText.replace(/^[\s\S]*?lg_\s*=\s*/, '');
    json = json.replace(/;\s*Tjs_ok_q_\s*=\s*true\s*;?\s*$/, '');
    json = json.replace(/;\s*$/, '');
    json = json.replace(/\n/g, '');
    json = json.replace(/(^|[{,])\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
    json = json.replace(/:(\s*)'([^']*)'/g, ':$1"$2"');

    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
        throw new Error(`Failed to parse Scoresheet JSON: ${e.message}`);
    }

    if (!parsed.rosters || !Array.isArray(parsed.rosters)) {
        throw new Error('Parsed data missing "rosters" array');
    }

    return { year, round, parsed };
}

/**
 * Build initial t1_by_pin map from rosters[].pins (same as Scoresheet's set_t1_by_pin).
 * Maps pin -> team number (1-indexed). Team 0 = unowned.
 */
function buildT1ByPin(rosters) {
    const t1 = {};
    for (let i = 0; i < rosters.length; i++) {
        const pins = rosters[i].pins || [];
        for (const pin of pins) {
            t1[pin] = i + 1; // 1-indexed team number
        }
    }
    return t1;
}

/**
 * Replay transactions from the -T.js file onto rosters and t1_by_pin.
 *
 * The -T.js file defines r(), d(), p(), u(), m() functions via a setup closure.
 * We only need r() (roster moves) and d() (draft picks) since those change ownership.
 *
 * r(mon0, day, from_team_1indexed, to_team, give_pins, get_pins, ...):
 *   - from_team gives give_pins, gets get_pins
 *   - if to_team > 0: it's a trade (to_team gives get_pins, gets give_pins)
 *   - if to_team == 0: it's a drop (give_pins go to unowned) or add (get_pins come from pool)
 *   - if to_team == -1: give_pins are released (set to team 0)
 *
 * d(team_1indexed, pin, compensation_team):
 *   - Draft pick: pin is assigned to team
 *
 * p(team_1indexed, pin, compensation_team):
 *   - Same as d() but also increments pick counter
 */
function replayTransactions(tJsText, rosters, t1ByPin) {
    // Extract pn_year_ and round1_ from -T.js header (they're redeclared there)
    const yearMatch = tJsText.match(/pn_year_=(\d{4})/);
    const roundMatch = tJsText.match(/round1_=(\d+)/);
    const round1 = roundMatch ? parseInt(roundMatch[1]) : 1;

    // Helper: add pin to a team's roster
    function addPin(teamIdx0, pin) {
        if (teamIdx0 < 0 || teamIdx0 >= rosters.length) return;
        const roster = rosters[teamIdx0];
        if (!roster.pins.includes(pin)) {
            roster.pins.push(pin);
            roster.pins.sort((a, b) => a - b);
        }
        t1ByPin[pin] = teamIdx0 + 1;
    }

    // Helper: remove pin from a team's roster
    function removePin(teamIdx0, pin) {
        if (teamIdx0 < 0 || teamIdx0 >= rosters.length) return;
        const roster = rosters[teamIdx0];
        const idx = roster.pins.indexOf(pin);
        if (idx >= 0) roster.pins.splice(idx, 1);
    }

    // The r() function: roster transaction
    function r(mon0, day, fromTeam1, toTeam1, givePins, getPins) {
        const fromIdx0 = fromTeam1 - 1;

        // from_team gives away givePins
        for (const pin of (givePins || [])) {
            removePin(fromIdx0, pin);
            if (toTeam1 > 0) {
                // Trade: pins go to to_team
                addPin(toTeam1 - 1, pin);
            } else {
                // Drop/release: pins become unowned
                t1ByPin[pin] = 0;
            }
        }

        // from_team receives getPins
        for (const pin of (getPins || [])) {
            // Remove from wherever they currently are
            const currentTeam = t1ByPin[pin];
            if (currentTeam > 0) {
                removePin(currentTeam - 1, pin);
            }
            addPin(fromIdx0, pin);
        }
    }

    // The d()/p() function: draft pick
    function d(team1, pin) {
        if (!pin || typeof pin === 'string') return;
        const currentTeam = t1ByPin[pin];
        if (currentTeam > 0) {
            removePin(currentTeam - 1, pin);
        }
        addPin(team1 - 1, pin);
    }

    // Execute the -T.js by evaluating it with our r/d/p/m/pm functions
    // Strip the header (pn_year_ and round1_ assignments)
    let code = tJsText.replace(/^pn_year_=\d+;\s*/m, '');
    code = code.replace(/^round1_=\d+;\s*/m, '');

    // Create a sandbox with our transaction functions
    const sandbox = {
        r: r,
        d: d,
        p: d, // p() is same as d() for our purposes (just assigns pin to team)
        u: function() {}, // undraft - ignore
        m: function() {}, // memo/message - ignore
        pm: function() {}, // ignore
        set_owners: function() {}, // owner name updates - ignore
    };

    // Execute each line
    const fn = new Function(...Object.keys(sandbox), code);
    fn(...Object.values(sandbox));
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

    // Fetch base roster file
    const jsText = await httpsGet(SS_BASE_URL + '.js');
    console.log(`  Downloaded BL_National_Pastime.js (${jsText.length} bytes)`);

    const { year, round, parsed } = parseScoresheetJS(jsText);
    const ownerNames = parsed.owner_names || [];
    console.log(`  Year: ${year}, Round: ${round}, Teams: ${parsed.rosters.length}`);

    // Build initial t1_by_pin from keeper pins
    const t1ByPin = buildT1ByPin(parsed.rosters);
    const initialPins = Object.keys(t1ByPin).length;
    console.log(`  Initial roster entries (keepers): ${initialPins}`);

    // Fetch and replay transactions
    const tJsText = await httpsGet(SS_BASE_URL + '-T.js');
    console.log(`  Downloaded BL_National_Pastime-T.js (${tJsText.length} bytes)`);
    replayTransactions(tJsText, parsed.rosters, t1ByPin);
    const finalPins = Object.values(t1ByPin).filter(t => t > 0).length;
    console.log(`  After transactions: ${finalPins} roster entries`);

    // Build flat roster list from t1_by_pin
    const teams = [];
    for (let i = 0; i < parsed.rosters.length; i++) {
        teams.push(ownerNames[i] || `Team ${i + 1}`);
    }

    const rosters = [];
    for (const [pinStr, teamN] of Object.entries(t1ByPin)) {
        if (teamN <= 0) continue; // skip unowned
        const pin = parseInt(pinStr);
        rosters.push({
            ssTeam: teams[teamN - 1],
            pin,
        });
    }
    console.log(`  Built ${rosters.length} roster entries across ${teams.length} teams`);

    // Fetch player details TSV
    const playersUrl = SS_PLAYERS_URL_TEMPLATE.replace('{YEAR}', year);
    console.log(`  Fetching ${playersUrl}...`);
    const tsvText = await httpsGet(playersUrl);
    const playerMap = parseTSV(tsvText);
    console.log(`  Loaded ${playerMap.size} players from TSV`);

    // Enrich roster entries with player details
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

    // Show per-team counts
    const teamCounts = {};
    for (const r of enrichedRosters) {
        teamCounts[r.ssTeam] = (teamCounts[r.ssTeam] || 0) + 1;
    }
    console.log('\n  Per-team roster sizes:');
    for (const [team, count] of Object.entries(teamCounts)) {
        console.log(`    ${team.substring(0, 30).padEnd(30)} ${count}`);
    }

    // Build output
    const output = {
        year,
        round,
        fetchedAt: new Date().toISOString(),
        teams,
        rosters: enrichedRosters,
    };

    const outPath = path.join(__dirname, '..', 'data', 'scoresheet_rosters.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`\nSaved to ${outPath}`);
    console.log(`  ${enrichedRosters.length} total roster entries across ${teams.length} teams`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
