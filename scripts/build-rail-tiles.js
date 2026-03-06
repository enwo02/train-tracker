#!/usr/bin/env node

/**
 * Railway tiler pipeline.
 *
 * Usage:
 *   1. Drop one or more *.osm.pbf extracts into data/
 *      (e.g. data/switzerland.osm.pbf, data/europe-latest.osm.pbf).
 *   2. Run: node scripts/build-rail-tiles.js
 *
 * Options:
 *   --fresh   Clear data/_tmp_rail_build and rebuild all steps from PBFs.
 *   --clean   Remove data/_tmp_rail_build when finished (default: keep it for next run).
 *
 * By default, steps that already have up-to-date outputs are skipped (e.g. re-running
 * skips osmium if the rail GeoJSON is already newer than the PBF).
 *
 * The script will:
 *   - For each *.osm.pbf in data/:
 *       * Use osmium to filter railway ways (rail, light_rail, subway, tram)
 *       * Export them as a temporary GeoJSON linestring file
 *   - Merge all temporary GeoJSONs
 *   - Tile them into 1° × 1° FeatureCollections:
 *       data/tiles/<lat>_<lon>.geojson
 *
 * Requirements:
 *   - Node.js
 *   - osmium-tool installed and available on PATH (`osmium` command)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const TMP_DIR = path.join(DATA_DIR, '_tmp_rail_build');
const OUTPUT_DIR = path.join(DATA_DIR, 'tiles');

const ARGS = process.argv.slice(2);
const FLAGS = {
    fresh: ARGS.includes('--fresh'),
    clean: ARGS.includes('--clean')
};

function ensureOsmium() {
    try {
        execSync('osmium --version', { stdio: 'ignore' });
    } catch (e) {
        console.error('Error: osmium-tool is not installed or not on PATH.');
        console.error('Install it, e.g. on macOS with: brew install osmium-tool');
        process.exit(1);
    }
}

function listPbfFiles() {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.osm.pbf'));
}

function run(cmd) {
    console.log(`$ ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });
}

function prepareTmpDir() {
    if (FLAGS.fresh && fs.existsSync(TMP_DIR)) {
        fs.readdirSync(TMP_DIR).forEach((f) => {
            fs.unlinkSync(path.join(TMP_DIR, f));
        });
        console.log('Cleared _tmp_rail_build (--fresh).');
    }
    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR, { recursive: true });
    }
}

function cleanTmpDir() {
    if (!fs.existsSync(TMP_DIR)) return;
    fs.readdirSync(TMP_DIR).forEach((f) => {
        fs.unlinkSync(path.join(TMP_DIR, f));
    });
    fs.rmdirSync(TMP_DIR);
}

function buildIntermediateGeoJSONs(pbfFiles) {
    pbfFiles.forEach((file) => {
        const base = path.basename(file, '.osm.pbf');
        const inputPbf = path.join(DATA_DIR, file);
        const railPbf = path.join(TMP_DIR, `${base}-rail-only.pbf`);
        const railGeo = path.join(TMP_DIR, `${base}-rail-only.geojson`);

        const inputMtime = fs.statSync(inputPbf).mtimeMs;
        const railPbfExists = fs.existsSync(railPbf);
        const railGeoExists = fs.existsSync(railGeo);

        const skipFilter = railPbfExists && fs.statSync(railPbf).mtimeMs >= inputMtime;
        const skipExport = railGeoExists && fs.existsSync(railPbf) && fs.statSync(railGeo).mtimeMs >= fs.statSync(railPbf).mtimeMs;

        if (skipFilter) {
            console.log(`Skipping tags-filter for ${file} (already up to date).`);
        } else {
            run(
                `osmium tags-filter "${inputPbf}" w/railway=rail,light_rail,subway,tram -o "${railPbf}"`
            );
        }

        if (skipExport) {
            console.log(`Skipping export for ${file} (already up to date).`);
        } else {
            run(
                `osmium export "${railPbf}" -o "${railGeo}" --geometry-types=linestring`
            );
        }
    });
}

function processFeatureIntoTiles(f, addToTileKey) {
    if (!f || !f.geometry) return;
    if (f.geometry.type !== 'LineString') return;
    const coords = f.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return;

    // Fast assignment: put a feature into tiles based on vertex locations.
    // This avoids the bbox explosion where one long rail line can get duplicated
    // into hundreds of 1°×1° tiles even if it only passes through a corridor.
    //
    // Note: in the rare case a segment crosses a tile without any vertices inside,
    // that tile won't get the feature. OSM rail geometries are typically dense enough
    // that this is acceptable for snapping.
    const keys = new Set();
    coords.forEach((pt) => {
        if (!Array.isArray(pt) || pt.length < 2) return;
        const lon = pt[0];
        const lat = pt[1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        keys.add(`${Math.floor(lat)}_${Math.floor(lon)}`);
    });

    keys.forEach((key) => addToTileKey(key));
}

/**
 * Stream a GeoJSON FeatureCollection file and push each feature into the tiles Map.
 * Avoids loading the whole file into memory (needed for multi-GB exports like Europe).
 * Reports progress: feature count and bytes read / total size.
 */
function streamGeoJSONIntoTiles(fullPath, addToTile) {
    return new Promise((resolve, reject) => {
        let fileSize = 0;
        try {
            fileSize = fs.statSync(fullPath).size;
        } catch (e) {}

        const stream = fs.createReadStream(fullPath, {
            encoding: 'utf8',
            highWaterMark: 64 * 1024
        });

        let buffer = '';
        let inFeatures = false;
        let fileDone = false;
        let depth = 0;
        let featureStart = -1;
        let inString = false;
        let escape = false;
        let scanPos = 0;
        let count = 0;
        let bytesRead = 0;
        let lastLogTime = 0;
        const LOG_INTERVAL_MS = 2000;

        const formatMb = (n) => (n / (1024 * 1024)).toFixed(1);
        const formatNum = (n) => n.toLocaleString();

        function maybeLogProgress(force) {
            const now = Date.now();
            if (!force && now - lastLogTime < LOG_INTERVAL_MS) return;
            lastLogTime = now;
            const pct = fileSize > 0 ? ((100 * bytesRead) / fileSize).toFixed(1) : '?';
            const sizeStr = fileSize > 0
                ? ` ${formatMb(bytesRead)} / ${formatMb(fileSize)} MB (${pct}%)`
                : ` ${formatMb(bytesRead)} MB read`;
            process.stdout.write(`  … ${formatNum(count)} features${sizeStr}\r`);
        }

        const FEATURES_PREFIX = '"features"';

        stream.on('data', (chunk) => {
            if (fileDone) return;
            buffer += chunk;
            bytesRead += chunk.length;

            outer: while (true) {
                if (!inFeatures) {
                    const idx = buffer.indexOf(FEATURES_PREFIX);
                    if (idx === -1) {
                        if (buffer.length > 500) buffer = buffer.slice(-100);
                        scanPos = 0;
                        break;
                    }
                    let start = idx + FEATURES_PREFIX.length;
                    while (start < buffer.length && /[\s:]/.test(buffer[start])) start++;
                    if (start >= buffer.length) break;
                    if (buffer[start] !== '[') {
                        buffer = buffer.slice(start);
                        scanPos = 0;
                        continue;
                    }
                    buffer = buffer.slice(start + 1);
                    inFeatures = true;
                    depth = 0;
                    featureStart = -1;
                    inString = false;
                    escape = false;
                    scanPos = 0;
                    continue;
                }

                let i = scanPos;
                for (; i < buffer.length; i++) {
                    const c = buffer[i];
                    if (inString) {
                        if (escape) {
                            escape = false;
                            continue;
                        }
                        if (c === '\\') {
                            escape = true;
                            continue;
                        }
                        if (c === '"') {
                            inString = false;
                        }
                        continue;
                    }

                    if (c === '"') {
                        inString = true;
                        continue;
                    }

                    if (c === '{') {
                        if (depth === 0) featureStart = i;
                        depth++;
                        continue;
                    }

                    if (c === '}') {
                        depth--;
                        if (depth === 0 && featureStart >= 0) {
                            const str = buffer.slice(featureStart, i + 1);
                            const f = JSON.parse(str);
                            processFeatureIntoTiles(f, (key) => addToTile(key, str));
                            count++;
                            maybeLogProgress(count % 50000 === 0);

                            featureStart = -1;
                            buffer = buffer.slice(i + 1);
                            scanPos = 0;
                            continue outer;
                        }
                        continue;
                    }

                    if (c === ']' && depth === 0) {
                        fileDone = true;
                        buffer = '';
                        scanPos = 0;
                        break outer;
                    }
                }
                scanPos = buffer.length;
                break;
            }
            maybeLogProgress();
        });

        stream.on('end', () => {
            maybeLogProgress(true);
            process.stdout.write('\n');
            if (count > 0) {
                console.log(`  Done: ${formatNum(count)} features from ${path.basename(fullPath)}`);
            }
            resolve();
        });
        stream.on('error', reject);
    });
}

function buildTilesFromTmpGeoJSONs() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    } else {
        // Clear existing tiles to avoid stale data.
        fs.readdirSync(OUTPUT_DIR)
            .filter((f) => f.endsWith('.geojson') || f.endsWith('.geojson.partial'))
            .forEach((f) => fs.unlinkSync(path.join(OUTPUT_DIR, f)));
    }

    const geoFiles = fs.readdirSync(TMP_DIR).filter((f) => f.endsWith('.geojson'));
    if (geoFiles.length === 0) {
        console.log('No intermediate GeoJSON files found in tmp directory.');
        return Promise.resolve();
    }

    // Incremental tile writing: tiles appear on disk during the run.
    // We write to *.geojson.partial first, then finalize + rename at the end.
    const tileStates = new Map(); // key -> { partialPath, finalPath, count, started }
    const FLUSH_THRESHOLD_CHARS = 256 * 1024; // ~256 KB of JSON text per tile before flushing
    const getTileState = (key) => {
        if (!tileStates.has(key)) {
            tileStates.set(key, {
                partialPath: path.join(OUTPUT_DIR, `${key}.geojson.partial`),
                finalPath: path.join(OUTPUT_DIR, `${key}.geojson`),
                count: 0,
                started: false,
                wroteFile: false,
                pending: ''
            });
        }
        return tileStates.get(key);
    };

    const flushTile = (state) => {
        if (!state.pending) return;
        if (!state.wroteFile) {
            fs.writeFileSync(state.partialPath, state.pending);
            state.wroteFile = true;
        } else {
            fs.appendFileSync(state.partialPath, state.pending);
        }
        state.pending = '';
    };

    const addToTile = (key, featureText) => {
        const state = getTileState(key);
        if (!state.started) {
            state.started = true;
            state.count = 1;
            state.pending = `{"type":"FeatureCollection","features":[\n${featureText}`;
            if (state.pending.length >= FLUSH_THRESHOLD_CHARS) flushTile(state);
            return;
        }
        state.pending += `,\n${featureText}`;
        state.count++;
        if (state.pending.length >= FLUSH_THRESHOLD_CHARS) flushTile(state);
    };

    let chain = Promise.resolve();
    geoFiles.forEach((file) => {
        const fullPath = path.join(TMP_DIR, file);
        chain = chain.then(() => {
            console.log(`Tiling ${file}...`);
            return streamGeoJSONIntoTiles(fullPath, addToTile);
        });
    });

    return chain.then(() => {
        const summary = [];
        for (const [key, state] of tileStates.entries()) {
            if (!state.started) continue;
            flushTile(state);
            if (!state.wroteFile) {
                fs.writeFileSync(state.partialPath, `{"type":"FeatureCollection","features":[\n]}\n`);
                state.wroteFile = true;
            } else {
                fs.appendFileSync(state.partialPath, `\n]}\n`);
            }
            fs.renameSync(state.partialPath, state.finalPath);
            const stats = fs.statSync(state.finalPath);
            summary.push({ key, count: state.count, sizeKB: Math.round(stats.size / 1024) });
        }

        summary.sort((a, b) => a.key.localeCompare(b.key));
        console.log(`Wrote ${summary.length} tiles:`);
        summary.forEach((t) => {
            console.log(`${t.key}: ${t.count} features, ~${t.sizeKB} KB`);
        });
    });
}

function main() {
    ensureOsmium();

    const pbfFiles = listPbfFiles();
    if (pbfFiles.length === 0) {
        console.log('No *.osm.pbf files found in data/. Nothing to do.');
        return;
    }

    console.log('Found PBF extracts in data/:');
    pbfFiles.forEach((f) => console.log(` - ${f}`));

    prepareTmpDir();

    (async () => {
        try {
            buildIntermediateGeoJSONs(pbfFiles);
            await buildTilesFromTmpGeoJSONs();
        } finally {
            if (FLAGS.clean) cleanTmpDir();
        }
    })().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

main();

