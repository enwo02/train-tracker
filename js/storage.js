const STORAGE_KEY = 'trainTrackerLines';

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
            lines.unshift(line);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
            return true;
        }
        return false;
    },

    removeLine(lineId) {
        let lines = this.getLines();
        lines = lines.filter(l => l.id !== lineId);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    },

    /**
     * Replace all stored lines with the given array.
     */
    setLines(lines) {
        try {
            const safeLines = Array.isArray(lines) ? lines : [];
            localStorage.setItem(STORAGE_KEY, JSON.stringify(safeLines));
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
            byId.set(line.id, line);
            added++;
        });

        const merged = Array.from(byId.values());
        this.setLines(merged);

        return {
            added,
            skipped,
            total: merged.length
        };
    }
};
