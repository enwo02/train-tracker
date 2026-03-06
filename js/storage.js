const STORAGE_KEY = 'trainTrackerLines';
const STORAGE_UPDATED_AT_KEY = 'trainTrackerLinesUpdatedAt';

/**
 * Simplify a LineString geometry using a Ramer–Douglas–Peucker style
 * algorithm in WebMercator meters. Tolerance is in meters.
 */
function simplifyLineStringCoordinates(coords, toleranceMeters) {
    if (!Array.isArray(coords) || coords.length <= 2 || !toleranceMeters || toleranceMeters <= 0) {
        return coords;
    }

    const R = 6378137; // WebMercator radius
    const rad = Math.PI / 180;

    const projected = coords.map((c) => {
        if (!Array.isArray(c) || c.length < 2) return null;
        const lon = c[0];
        const lat = c[1];
        if (typeof lon !== 'number' || typeof lat !== 'number') return null;
        const x = R * lon * rad;
        const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));
        return { x, y };
    });

    if (projected.some((p) => p == null)) {
        return coords;
    }

    const sqTolerance = toleranceMeters * toleranceMeters;

    function getSqSegDist(p, p1, p2) {
        let x = p1.x;
        let y = p1.y;
        let dx = p2.x - x;
        let dy = p2.y - y;

        if (dx !== 0 || dy !== 0) {
            const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) {
                x = p2.x;
                y = p2.y;
            } else if (t > 0) {
                x += dx * t;
                y += dy * t;
            }
        }

        dx = p.x - x;
        dy = p.y - y;
        return dx * dx + dy * dy;
    }

    const keep = new Array(coords.length).fill(false);
    keep[0] = true;
    keep[coords.length - 1] = true;

    function simplifySegment(first, last) {
        if (last <= first + 1) return;

        const p1 = projected[first];
        const p2 = projected[last];
        let index = -1;
        let maxSqDist = 0;

        for (let i = first + 1; i < last; i++) {
            const sqDist = getSqSegDist(projected[i], p1, p2);
            if (sqDist > maxSqDist) {
                maxSqDist = sqDist;
                index = i;
            }
        }

        if (maxSqDist > sqTolerance && index !== -1) {
            keep[index] = true;
            simplifySegment(first, index);
            simplifySegment(index, last);
        }
    }

    simplifySegment(0, coords.length - 1);

    const out = [];
    for (let i = 0; i < coords.length; i++) {
        if (keep[i]) {
            out.push(coords[i]);
        }
    }
    return out;
}

/**
 * Simplify a GeoJSON-like geometry object (LineString or MultiLineString).
 * Returns a new geometry object; original is not mutated.
 */
function simplifyGeometry(geometry, toleranceMeters) {
    if (!geometry || !Array.isArray(geometry.coordinates)) {
        return geometry;
    }

    const tol = typeof toleranceMeters === 'number' && toleranceMeters > 0
        ? toleranceMeters
        : 50; // default ~50m

    if (geometry.type === 'LineString') {
        return {
            ...geometry,
            coordinates: simplifyLineStringCoordinates(geometry.coordinates, tol)
        };
    }

    if (geometry.type === 'MultiLineString') {
        const simplifiedParts = geometry.coordinates.map((part) =>
            simplifyLineStringCoordinates(part, tol)
        );
        return {
            ...geometry,
            coordinates: simplifiedParts
        };
    }

    return geometry;
}

function notifyLinesChanged() {
    try {
        localStorage.setItem(STORAGE_UPDATED_AT_KEY, String(Date.now()));
    } catch (e) { /* ignore */ }

    try {
        // Used by Drive sync (and potentially other integrations)
        window.dispatchEvent(new CustomEvent('trainTrackerLinesChanged'));
    } catch (e) { /* ignore */ }
}

const Storage = {
    getLines() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error("Error reading from local storage", e);
            return [];
        }
    },

    saveLine(line) {
        const lines = this.getLines();
        // Check if already exists by referencing feature ID
        if (!lines.some(l => l.id === line.id)) {
            const toStore = { ...line };
            if (toStore.geometry) {
                toStore.geometry = simplifyGeometry(toStore.geometry);
            }
            lines.unshift(toStore);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
            notifyLinesChanged();
            return true;
        }
        return false;
    },

    removeLine(lineId) {
        let lines = this.getLines();
        lines = lines.filter(l => l.id !== lineId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
        notifyLinesChanged();
    },

    /**
     * Replace all stored lines with the given array.
     */
    setLines(lines) {
        try {
            const safeLines = Array.isArray(lines) ? lines : [];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(safeLines));
            notifyLinesChanged();
        } catch (e) {
            console.error("Error writing routes to local storage", e);
        }
    },

    /**
     * Merge an imported array of lines into storage, skipping duplicates by id.
     * Returns a small summary object: { added, skipped, total }.
     */
    importLines(lines) {
        const incoming = Array.isArray(lines) ? lines : [];
        if (incoming.length === 0) {
            return { added: 0, skipped: 0, total: this.getLines().length };
        }

        const existing = this.getLines();
        const byId = new Map();

        existing.forEach(line => {
            if (line && line.id != null) {
                byId.set(line.id, line);
            }
        });

        let added = 0;
        let skipped = 0;

        incoming.forEach(line => {
            if (!line || line.id == null) {
                skipped++;
                return;
            }
            if (byId.has(line.id)) {
                skipped++;
                return;
            }
            const normalized = { ...line };
            if (normalized.geometry) {
                normalized.geometry = simplifyGeometry(normalized.geometry);
            }
            byId.set(normalized.id, normalized);
            added++;
        });

        const merged = Array.from(byId.values());
        this.setLines(merged);
        // notifyLinesChanged() is called by setLines()

        return {
            added,
            skipped,
            total: merged.length
        };
    }
};

/**
 * One-off helper to shrink existing stored routes in place by simplifying
 * their geometries. Can be invoked from the browser console:
 *
 *   compactTrainTrackerLines();            // default ~50m tolerance
 *   compactTrainTrackerLines(100);         // ~100m tolerance
 */
window.compactTrainTrackerLines = function (toleranceMeters) {
    try {
        if (typeof Storage === 'undefined' || !Storage || typeof Storage.getLines !== 'function') {
            return;
        }
        const original = Storage.getLines();
        const tol = (typeof toleranceMeters === 'number' && toleranceMeters > 0) ? toleranceMeters : 50;
        const simplified = Array.isArray(original)
            ? original.map((line) => {
                if (!line || !line.geometry) return line;
                return {
                    ...line,
                    geometry: simplifyGeometry(line.geometry, tol)
                };
            })
            : [];
        Storage.setLines(simplified);
    } catch (e) {
        // best-effort only
        console.error('compactTrainTrackerLines failed', e);
    }
};
