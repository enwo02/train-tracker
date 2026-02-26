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
    }
};
