#!/usr/bin/env node

/**
 * Simple tiler for railway GeoJSON.
 *
 * Input:
 *   data/switzerland-rail-only.geojson
 *
 * Output:
 *   data/tiles/<lat>_<lon>.geojson (1° × 1° tiles, FeatureCollections)
 *
 * A feature is written to every tile whose 1° bbox intersects the feature's
 * own bbox. Features that cross tile boundaries are therefore duplicated in
 * neighbouring tiles, which is fine for our use case.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const INPUT = path.join(PROJECT_ROOT, 'data', 'switzerland-rail-only.geojson');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'data', 'tiles');

function main() {
    if (!fs.existsSync(INPUT)) {
        console.error(`Input file not found: ${INPUT}`);
        process.exit(1);
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const raw = fs.readFileSync(INPUT, 'utf8');
    const geo = JSON.parse(raw);
    const features = Array.isArray(geo.features) ? geo.features : [];

    const tiles = new Map(); // key -> array of features

    const addToTile = (key, feature) => {
        if (!tiles.has(key)) tiles.set(key, []);
        tiles.get(key).push(feature);
    };

    features.forEach((f) => {
        if (!f || !f.geometry) return;
        if (f.geometry.type !== 'LineString') return;
        const coords = f.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return;

        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;

        coords.forEach(([lon, lat]) => {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lon < minLon) minLon = lon;
            if (lon > maxLon) maxLon = lon;
        });

        if (!Number.isFinite(minLat) || !Number.isFinite(minLon)) return;

        const latStart = Math.floor(minLat);
        const latEnd = Math.floor(maxLat);
        const lonStart = Math.floor(minLon);
        const lonEnd = Math.floor(maxLon);

        for (let lat = latStart; lat <= latEnd; lat++) {
            for (let lon = lonStart; lon <= lonEnd; lon++) {
                const key = `${lat}_${lon}`;
                addToTile(key, f);
            }
        }
    });

    const summary = [];

    for (const [key, feats] of tiles.entries()) {
        const [lat, lon] = key.split('_');
        const outPath = path.join(OUTPUT_DIR, `${lat}_${lon}.geojson`);
        const fc = {
            type: 'FeatureCollection',
            features: feats
        };
        fs.writeFileSync(outPath, JSON.stringify(fc));
        const stats = fs.statSync(outPath);
        summary.push({ key, count: feats.length, sizeKB: Math.round(stats.size / 1024) });
    }

    summary.sort((a, b) => a.key.localeCompare(b.key));
    console.log('Wrote tiles:');
    summary.forEach((t) => {
        console.log(`${t.key}: ${t.count} features, ~${t.sizeKB} KB`);
    });
}

main();

