const App = {
    state: {
        startStation: null,
        endStation: null,
        routeOptions: [],
        selectedRoute: null,
        loading: false,
        activeInput: null // 'start' or 'end'
    },

    // UI Elements
    ui: {
        inputStart: document.getElementById('input-start'),
        inputEnd: document.getElementById('input-end'),
        autocompleteStart: document.getElementById('autocomplete-start'),
        autocompleteEnd: document.getElementById('autocomplete-end'),
        btnSearchRoute: document.getElementById('btn-search-route'),

        loadingIndicator: document.getElementById('loading-indicator'),
        loadingText: document.getElementById('loading-text'),

        routeOptionsContainer: document.getElementById('route-options-container'),
        routeOptionsList: document.getElementById('route-options-list'),

        savedLinesContainer: document.getElementById('saved-lines-container'),
        linesList: document.getElementById('lines-list'),
        lineCount: document.getElementById('line-count'),
        emptyState: document.getElementById('empty-state'),

        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toast-message')
    },

    // Debounce timer for autocomplete
    searchTimeout: null,

    init() {
        MapManager.init();
        this.bindEvents();
        this.updateSavedUI();
    },

    bindEvents() {
        // Autocomplete Inputs
        this.ui.inputStart.addEventListener('input', (e) => this.handleInput(e.target.value, 'start'));
        this.ui.inputEnd.addEventListener('input', (e) => this.handleInput(e.target.value, 'end'));

        // Hide autocomplete when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.ui.inputStart.contains(e.target) && !this.ui.autocompleteStart.contains(e.target)) {
                this.ui.autocompleteStart.classList.add('hidden');
            }
            if (!this.ui.inputEnd.contains(e.target) && !this.ui.autocompleteEnd.contains(e.target)) {
                this.ui.autocompleteEnd.classList.add('hidden');
            }
        });

        // Search Route Button
        this.ui.btnSearchRoute.addEventListener('click', () => this.searchRoute());
    },

    handleInput(value, type) {
        clearTimeout(this.searchTimeout);

        // Clear selection if input changes
        if (type === 'start') this.state.startStation = null;
        if (type === 'end') this.state.endStation = null;

        this.updateSearchBtnState();

        const listEl = type === 'start' ? this.ui.autocompleteStart : this.ui.autocompleteEnd;

        if (value.length < 3) {
            listEl.classList.add('hidden');
            return;
        }

        this.searchTimeout = setTimeout(async () => {
            const results = await API.searchStation(value);
            this.renderAutocomplete(results, type);
        }, 500); // 500ms debounce
    },

    renderAutocomplete(results, type) {
        const listEl = type === 'start' ? this.ui.autocompleteStart : this.ui.autocompleteEnd;
        listEl.innerHTML = '';

        if (results.length === 0) {
            listEl.classList.add('hidden');
            return;
        }

        results.forEach(station => {
            const li = document.createElement('li');
            li.className = 'autocomplete-item';
            li.textContent = station.name;
            li.title = station.fullName;

            li.addEventListener('click', () => {
                this.selectStation(station, type);
            });

            listEl.appendChild(li);
        });

        listEl.classList.remove('hidden');
    },

    selectStation(station, type) {
        if (type === 'start') {
            this.state.startStation = station;
            this.ui.inputStart.value = station.name;
            this.ui.autocompleteStart.classList.add('hidden');
        } else {
            this.state.endStation = station;
            this.ui.inputEnd.value = station.name;
            this.ui.autocompleteEnd.classList.add('hidden');
        }

        // Center map on station temporarily
        MapManager.map.setView([station.lat, station.lon], 13);

        this.updateSearchBtnState();
    },

    updateSearchBtnState() {
        if (this.state.startStation && this.state.endStation) {
            this.ui.btnSearchRoute.disabled = false;
        } else {
            this.ui.btnSearchRoute.disabled = true;
        }
    },

    setLoading(isLoading, text = "Searching...") {
        this.state.loading = isLoading;
        this.ui.loadingText.textContent = text;
        if (isLoading) {
            this.ui.loadingIndicator.classList.remove('hidden');
            this.ui.btnSearchRoute.disabled = true;
        } else {
            this.ui.loadingIndicator.classList.add('hidden');
            this.updateSearchBtnState();
        }
    },

    async searchRoute() {
        if (!this.state.startStation || !this.state.endStation) return;

        this.setLoading(true, "Finding train lines between stations...");
        this.ui.routeOptionsContainer.classList.add('hidden');
        this.ui.savedLinesContainer.classList.add('hidden');
        MapManager.clearTempLine();

        try {
            const routes = await API.findRouteBetweenStations(this.state.startStation, this.state.endStation);
            console.log("Found routes in app.js:", routes);

            const deduped = this.dedupeRoutesForUi(routes);
            this.state.routeOptions = deduped;

            if (deduped.length === 0) {
                this.showToast("Could not find any direct train lines mapped between these stations.");
                this.ui.savedLinesContainer.classList.remove('hidden');
            } else {
                this.renderRouteOptions(deduped);
            }
        } catch (err) {
            this.showToast("Failed to search for routes. Overpass API might be busy.");
        } finally {
            this.setLoading(false);
        }
    },

    /**
     * Collapse raw OJP trips into a minimal set of user-facing options.
     * Strategy:
     * - Group by (from, to).
     * - Within each group:
     *   - Prefer variants that have a `via` label; if any exist, drop all
     *     routes without `via` for that (from, to) pair.
     *   - Then keep only the first route for each distinct `via` value
     *     (so you get at most one "via Liestal", one "via Rheinfelden", etc.).
     */
    dedupeRoutesForUi(routes) {
        const groups = new Map(); // key: "from|to" -> array of routes

        routes.forEach(route => {
            const p = route.properties || {};
            const from = p.from || '';
            const to = p.to || '';
            const key = `${from}|${to}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(route);
        });

        const result = [];

        groups.forEach(groupRoutes => {
            const hasVia = groupRoutes.some(r => (r.properties && r.properties.via));

            // If we have any via-labelled routes, drop the ones without via
            let candidates = hasVia
                ? groupRoutes.filter(r => r.properties && r.properties.via)
                : groupRoutes;

            const seenVia = new Set();

            for (const r of candidates) {
                const via = (r.properties && r.properties.via) || '';
                const viaKey = via || '__NO_VIA__';
                if (seenVia.has(viaKey)) continue;
                seenVia.add(viaKey);
                result.push(r);
            }
        });

        return result;
    },

    renderRouteOptions(routes) {
        this.ui.routeOptionsList.innerHTML = '';

        // Show the top results
        routes.forEach((route, index) => {
            const props = route.properties;
            const item = document.createElement('div');
            item.className = 'route-item';

            const title = props.from && props.to ? `${props.from} ➔ ${props.to}` : (props.name || '');
            const dirMeta = props.directionTo && props.directionTo !== props.to
                ? `<div class="line-meta">Dir: ${props.from} ➔ ${props.directionTo}</div>`
                : '';
            const viaMeta = props.via ? `<div class="line-meta">Via: ${props.via}</div>` : '';
            // Only show operator if it looks meaningful (not just an internal numeric code).
            const hasOperator = props.operator && !/^\d+$/.test(props.operator.trim());
            const operatorMeta = hasOperator ? `<div class="line-meta">Operator: ${props.operator.trim()}</div>` : '';
            // Departure time didn't add much value for your use case, so we omit it from the UI for now.
            const timeMeta = '';

            item.innerHTML = `
                <div class="line-info">
                    <div class="line-name">${title}</div>
                    ${dirMeta}
                    ${viaMeta}
                    ${timeMeta}
                    ${operatorMeta}
                </div>
                <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;">Add</button>
            `;

            // Hover to preview
            item.addEventListener('mouseenter', () => {
                MapManager.drawTempLine(route);
            });

            item.addEventListener('mouseleave', () => {
                MapManager.clearTempLine();
            });

            // Click button to add
            const btn = item.querySelector('button');
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent anything else from firing
                this.addRoute(route);
            });

            this.ui.routeOptionsList.appendChild(item);
        });

        this.ui.routeOptionsContainer.classList.remove('hidden');
    },

    addRoute(routeFeature) {
        // Clear any temporary preview
        MapManager.clearTempLine();

        // Add to storage
        const added = Storage.saveLine(routeFeature);
        if (added) {
            this.showToast(`Saved ${routeFeature.properties.name}`);
        } else {
            this.showToast(`Route ${routeFeature.properties.name} is already saved`);
        }

        // Switch back to saved lines view automatically after a delay or user can back out
        this.resetSearch();
    },

    resetSearch() {
        this.ui.inputStart.value = '';
        this.ui.inputEnd.value = '';
        this.state.startStation = null;
        this.state.endStation = null;
        this.updateSearchBtnState();

        this.ui.routeOptionsContainer.classList.add('hidden');
        this.ui.savedLinesContainer.classList.remove('hidden');
        MapManager.clearTempLine(); // Clear preview because it's now in saved lines
        this.updateSavedUI();
    },

    showToast(message) {
        this.ui.toastMessage.textContent = message;
        this.ui.toast.classList.remove('hidden');

        setTimeout(() => {
            this.ui.toast.classList.add('hidden');
        }, 3000);
    },

    updateSavedUI() {
        const lines = Storage.getLines();

        // Update Map Layers
        MapManager.renderSavedLines(lines);

        // Update Sidebar Count
        this.ui.lineCount.textContent = lines.length;

        // Update List View
        if (lines.length > 0) {
            this.ui.emptyState.style.display = 'none';

            const existingItems = this.ui.linesList.querySelectorAll('.line-item');
            existingItems.forEach(item => item.remove());

            lines.forEach(line => {
                const item = document.createElement('div');
                item.className = 'line-item';

                const props = line.properties;

                item.innerHTML = `
                    <div class="line-info">
                        <div class="line-name" title="${props.name}">${props.name}</div>
                        <div class="line-meta">${props.network || 'Train Network'}</div>
                    </div>
                    <button class="btn-icon" aria-label="Delete line" data-id="${line.id}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            <line x1="10" y1="11" x2="10" y2="17"></line>
                            <line x1="14" y1="11" x2="14" y2="17"></line>
                        </svg>
                    </button>
                `;

                // Add delete event
                item.querySelector('.btn-icon').addEventListener('click', (e) => {
                    e.stopPropagation();
                    Storage.removeLine(line.id);
                    this.updateSavedUI();
                });

                // Add click-to-focus event
                item.addEventListener('click', () => {
                    const temp = L.geoJSON(line);
                    try {
                        MapManager.map.fitBounds(temp.getBounds(), {
                            paddingTopLeft: [50, 50],
                            paddingBottomRight: [450, 50],
                            maxZoom: 12
                        });
                    } catch (e) { }
                });

                this.ui.linesList.appendChild(item);
            });
        } else {
            this.ui.emptyState.style.display = 'block';
            this.ui.linesList.querySelectorAll('.line-item').forEach(item => item.remove());
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
