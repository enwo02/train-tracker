const App = {
    state: {
        startStation: null,
        endStation: null,
        routeOptions: [],
        selectedRoute: null,
        loading: false,
        activeInput: null, // 'start' or 'end'
        isDrawingManual: false
    },

    // UI Elements
    ui: {
        inputStart: document.getElementById('input-start'),
        inputEnd: document.getElementById('input-end'),
        autocompleteStart: document.getElementById('autocomplete-start'),
        autocompleteEnd: document.getElementById('autocomplete-end'),
        btnSearchRoute: document.getElementById('btn-search-route'),
        btnSwapStations: document.getElementById('btn-swap-stations'),
        btnDrawRoute: document.getElementById('btn-draw-route'),
        drawHint: document.getElementById('draw-hint'),

        loadingIndicator: document.getElementById('loading-indicator'),
        loadingText: document.getElementById('loading-text'),

        routeOptionsContainer: document.getElementById('route-options-container'),
        routeOptionsList: document.getElementById('route-options-list'),

        savedLinesContainer: document.getElementById('saved-lines-container'),
        linesList: document.getElementById('lines-list'),
        lineCount: document.getElementById('line-count'),
        emptyState: document.getElementById('empty-state'),

        btnExportRoutes: document.getElementById('btn-export-routes'),
        btnImportRoutes: document.getElementById('btn-import-routes'),
        inputImportFile: document.getElementById('input-import-file'),
        btnMergeRoutes: document.getElementById('btn-merge-routes'),

        totalKm: document.getElementById('total-km'),

        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toast-message')
    },

    /**
     * Approximate length of a route in kilometers using the haversine formula.
     * Accepts an array of [lon, lat] coordinates, or a flattened version of
     * a GeoJSON MultiLineString.
     */
    computeRouteLengthKm(coords) {
        if (!coords || coords.length < 2) return 0;

        const R = 6371; // Earth radius in km
        const toRad = (deg) => deg * Math.PI / 180;

        let total = 0;
        for (let i = 1; i < coords.length; i++) {
            const [lon1, lat1] = coords[i - 1];
            const [lon2, lat2] = coords[i];
            if (
                typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
                typeof lat2 !== 'number' || typeof lon2 !== 'number'
            ) {
                continue;
            }

            const dLat = toRad(lat2 - lat1);
            const dLon = toRad(lon2 - lon1);
            const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            total += R * c;
        }

        return total;
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

        // Swap A/B stations
        if (this.ui.btnSwapStations) {
            this.ui.btnSwapStations.addEventListener('click', () => this.swapStations());
        }

        // Manual draw button for custom routes
        if (this.ui.btnDrawRoute) {
            this.ui.btnDrawRoute.addEventListener('click', () => this.toggleManualDraw());
        }

        // Export / Import saved routes
        if (this.ui.btnExportRoutes) {
            this.ui.btnExportRoutes.addEventListener('click', () => this.exportRoutes());
        }
        if (this.ui.btnImportRoutes && this.ui.inputImportFile) {
            this.ui.btnImportRoutes.addEventListener('click', () => {
                this.ui.inputImportFile.click();
            });
            this.ui.inputImportFile.addEventListener('change', (e) => this.handleImportFile(e));
        }

        // Merge selected saved routes
        if (this.ui.btnMergeRoutes) {
            this.ui.btnMergeRoutes.addEventListener('click', () => this.mergeSelectedRoutes());
        }

        // Allow cancelling drawing with Esc key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.state.isDrawingManual) {
                this.cancelManualDraw();
            }
        });
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
     *
     * Strategy:
     * - Group by (from, to).
     * - Within each group, compare paths using a coarse bounding box so that
     *   trips following the same corridor collapse into one option while
     *   genuinely different paths remain separate.
     *   - bboxKey = rounded min/max lat/lon of the geometry.
     *   - For a given bboxKey, if there are multiple routes:
     *     - Prefer the variant that has a `via` label, otherwise keep the first.
     *
     * This preserves all genuinely different paths while avoiding duplicates
     * when the corridor is the same but departure times or service ids differ.
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
            const byBBox = new Map(); // bboxKey -> best route

            const getBBoxKey = (coords) => {
                if (!coords || coords.length === 0) return '';
                let minLat = Infinity, maxLat = -Infinity;
                let minLon = Infinity, maxLon = -Infinity;

                coords.forEach(([lon, lat]) => {
                    if (lat < minLat) minLat = lat;
                    if (lat > maxLat) maxLat = lat;
                    if (lon < minLon) minLon = lon;
                    if (lon > maxLon) maxLon = lon;
                });

                // Round to ~1 km resolution
                const r = (v) => v.toFixed(2);
                return `${r(minLat)}|${r(minLon)}|${r(maxLat)}|${r(maxLon)}`;
            };

            groupRoutes.forEach(route => {
                const coords = route.geometry && route.geometry.coordinates;
                if (!coords || coords.length < 2) return;

                const bboxKey = getBBoxKey(coords);
                const existing = byBBox.get(bboxKey);

                if (!existing) {
                    byBBox.set(bboxKey, route);
                    return;
                }

                const hasViaExisting = !!(existing.properties && existing.properties.via);
                const hasViaNew = !!(route.properties && route.properties.via);

                // Prefer a route that has a via label for this corridor.
                if (!hasViaExisting && hasViaNew) {
                    byBBox.set(bboxKey, route);
                }
            });

            byBBox.forEach(route => result.push(route));
        });

        return result;
    },

    renderRouteOptions(routes) {
        this.ui.routeOptionsList.innerHTML = '';

        // Show the top results
        routes.forEach((route, index) => {
            const props = route.properties;
            const coords = route.geometry && route.geometry.coordinates;
            const lengthKm = this.computeRouteLengthKm(coords);
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
            const distanceMeta = lengthKm > 0
                ? `<div class="line-meta">Length: ${lengthKm.toFixed(1)} km</div>`
                : '';

            item.innerHTML = `
                <div class="line-info">
                    <div class="line-name">${title}</div>
                    ${dirMeta}
                    ${viaMeta}
                    ${distanceMeta}
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

    /**
     * Toggle manual drawing mode on/off. When turning off and a valid line
     * has been drawn, save the snapped railway geometry as a route.
     */
    async toggleManualDraw() {
        if (!this.state.isDrawingManual) {
            // Enter drawing mode
            this.state.isDrawingManual = true;
            if (this.ui.btnDrawRoute) {
                this.ui.btnDrawRoute.textContent = 'Finish drawing (save route)';
            }
            if (this.ui.drawHint) {
                this.ui.drawHint.classList.remove('hidden');
            }
            await MapManager.startManualDraw();
            this.showToast('Click along the track on the map to trace your route.');
            return;
        }

        // Finish drawing and save using the snapped railway geometry that
        // MapManager has built up.
        const coords = MapManager.getManualDrawCoordinates();
        if (!coords || coords.length < 2) {
            this.showToast('Add at least two points on the map to define a route.');
            return;
        }

        const defaultName = 'Custom route';
        const name = prompt('Name this route (e.g. Zürich HB ➔ Chur):', defaultName) || defaultName;
        const trimmedName = name.trim() || defaultName;

        const id = `manual-${Date.now()}`;
        const feature = {
            type: 'Feature',
            id: id,
            properties: {
                id: id,
                name: trimmedName,
                source: 'manual'
            },
            geometry: {
                type: 'LineString',
                coordinates: coords
            }
        };

        const added = Storage.saveLine(feature);
        if (added) {
            this.showToast(`Saved ${trimmedName}`);
        } else {
            this.showToast(`${trimmedName} is already saved`);
        }

        MapManager.cancelManualDraw();
        this.state.isDrawingManual = false;
        if (this.ui.btnDrawRoute) {
            this.ui.btnDrawRoute.textContent = 'Draw custom route on map';
        }
        if (this.ui.drawHint) {
            this.ui.drawHint.classList.add('hidden');
        }

        this.updateSavedUI();
    },

    /**
     * Cancel drawing without saving the current manual route.
     */
    cancelManualDraw() {
        MapManager.cancelManualDraw();
        this.state.isDrawingManual = false;
        if (this.ui.btnDrawRoute) {
            this.ui.btnDrawRoute.textContent = 'Draw custom route on map';
        }
        if (this.ui.drawHint) {
            this.ui.drawHint.classList.add('hidden');
        }
        this.showToast('Drawing cancelled');
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

    /**
     * Export all saved routes to a JSON file for download.
     */
    exportRoutes() {
        const lines = Storage.getLines();
        if (!lines || lines.length === 0) {
            this.showToast("You don't have any saved routes to export yet.");
            return;
        }

        const payload = {
            app: 'train-tracker',
            version: 1,
            exportedAt: new Date().toISOString(),
            lines
        };

        try {
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'train-tracker-routes.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.showToast('Exported saved routes.');
        } catch (e) {
            console.error('Failed to export routes', e);
            this.showToast('Could not export routes.');
        }
    },

    /**
     * Handle import of routes from a JSON file previously exported.
     */
    handleImportFile(event) {
        const input = event.target;
        const file = input.files && input.files[0];
        if (!file) {
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = String(reader.result || '');
                const parsed = JSON.parse(text);

                // Support both raw array exports and wrapped objects.
                let lines = [];
                if (Array.isArray(parsed)) {
                    lines = parsed;
                } else if (parsed && Array.isArray(parsed.lines)) {
                    lines = parsed.lines;
                }

                if (!lines || lines.length === 0) {
                    this.showToast('No routes found in the selected file.');
                    return;
                }

                const result = Storage.importLines(lines);
                if (result.added === 0) {
                    this.showToast('No new routes to import.');
                } else {
                    const plural = result.added === 1 ? '' : 's';
                    this.showToast(`Imported ${result.added} route${plural}.`);
                }

                this.updateSavedUI();
            } catch (e) {
                console.error('Failed to import routes', e);
                this.showToast('Could not read routes file.');
            } finally {
                // Reset input so the same file can be chosen again if needed.
                input.value = '';
            }
        };

        reader.onerror = () => {
            console.error('Error reading routes file');
            this.showToast('Could not read routes file.');
            input.value = '';
        };

        reader.readAsText(file);
    },

    updateSavedUI() {
        const lines = Storage.getLines();

        // Update Map Layers
        MapManager.renderSavedLines(lines);

        // Update Sidebar Count
        this.ui.lineCount.textContent = lines.length;

        // Compute and display total track kilometers
        let totalKm = 0;
        lines.forEach(line => {
            const geom = line.geometry;
            if (!geom || !Array.isArray(geom.coordinates)) return;
            if (geom.type === 'LineString') {
                totalKm += this.computeRouteLengthKm(geom.coordinates);
            } else if (geom.type === 'MultiLineString') {
                geom.coordinates.forEach(part => {
                    if (Array.isArray(part) && part.length >= 2) {
                        totalKm += this.computeRouteLengthKm(part);
                    }
                });
            }
        });

        if (this.ui.totalKm) {
            if (totalKm > 0) {
                this.ui.totalKm.textContent = `${Math.round(totalKm)} km`;
                this.ui.totalKm.classList.remove('hidden');
            } else {
                this.ui.totalKm.classList.add('hidden');
            }
        }

        // Update List View
        if (lines.length > 0) {
            this.ui.emptyState.style.display = 'none';

            const existingItems = this.ui.linesList.querySelectorAll('.line-item');
            existingItems.forEach(item => item.remove());

            lines.forEach(line => {
                const item = document.createElement('div');
                item.className = 'line-item';

                const props = line.properties || {};
                const geometry = line.geometry;
                let lengthKm = 0;
                if (geometry && Array.isArray(geometry.coordinates)) {
                    if (geometry.type === 'LineString') {
                        lengthKm = this.computeRouteLengthKm(geometry.coordinates);
                    } else if (geometry.type === 'MultiLineString') {
                        geometry.coordinates.forEach(part => {
                            if (Array.isArray(part) && part.length >= 2) {
                                lengthKm += this.computeRouteLengthKm(part);
                            }
                        });
                    }
                }
                const title = props.displayName
                    ? props.displayName
                    : (props.from && props.to ? `${props.from} ➔ ${props.to}` : (props.name || ''));
                const dirMeta = props.directionTo && props.directionTo !== props.to
                    ? `<div class="line-meta">Dir: ${props.from} ➔ ${props.directionTo}</div>`
                    : '';
                const viaMeta = props.via ? `<div class="line-meta">Via: ${props.via}</div>` : '';
                const hasOperator = props.operator && !/^\d+$/.test(String(props.operator).trim());
                const operatorMeta = hasOperator ? `<div class="line-meta">Operator: ${String(props.operator).trim()}</div>` : '';
                const distanceMeta = lengthKm > 0
                    ? `<div class="line-meta">Length: ${lengthKm.toFixed(1)} km</div>`
                    : '';

                item.innerHTML = `
                    <label class="line-select">
                        <input type="checkbox" class="line-select-checkbox" data-id="${line.id}">
                    </label>
                    <div class="line-info">
                        <div class="line-name" title="${title}">${title}</div>
                        ${dirMeta}
                        ${viaMeta}
                        ${distanceMeta}
                        ${operatorMeta}
                    </div>
                    <div class="line-actions">
                        <button class="btn-icon btn-icon-edit" aria-label="Rename line" data-id="${line.id}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                            </svg>
                        </button>
                        <button class="btn-icon btn-icon-delete" aria-label="Delete line" data-id="${line.id}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                <line x1="10" y1="11" x2="10" y2="17"></line>
                                <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                        </button>
                    </div>
                `;

                // Checkbox selection -> update map highlight for merge preview
                const checkbox = item.querySelector('.line-select-checkbox');
                if (checkbox) {
                    checkbox.addEventListener('change', () => {
                        this.updateMergeSelectionHighlight();
                    });
                }

                // Add rename event
                const renameBtn = item.querySelector('.btn-icon-edit');
                if (renameBtn) {
                    renameBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const currentTitle = title || '';
                        const newName = prompt('Rename this route:', currentTitle);
                        if (!newName) return;
                        const trimmed = newName.trim();
                        if (!trimmed || trimmed === currentTitle) return;

                        const allLines = Storage.getLines();
                        const updatedLines = allLines.map(l => {
                            if (l.id !== line.id) return l;
                            const lProps = l.properties || {};
                            return {
                                ...l,
                                properties: {
                                    ...lProps,
                                    displayName: trimmed
                                }
                            };
                        });
                        Storage.setLines(updatedLines);
                        this.updateSavedUI();
                    });
                }

                // Add delete event
                item.querySelector('.btn-icon-delete').addEventListener('click', (e) => {
                    e.stopPropagation();
                    Storage.removeLine(line.id);
                    this.updateSavedUI();
                });

                // Hover to visually highlight the corresponding saved route on the map.
                // When routes are selected for merge, hover still works: selected + hovered stay bright, others dim.
                item.addEventListener('mouseenter', () => {
                    if (typeof MapManager === 'undefined' || !MapManager) return;
                    const selectedIds = Array.from(this.ui.linesList.querySelectorAll('.line-select-checkbox:checked'))
                        .map(cb => String(cb.getAttribute('data-id')))
                        .filter(id => id != null);
                    if (selectedIds.length > 0) {
                        const toHighlight = [...new Set([...selectedIds, String(line.id)])];
                        if (typeof MapManager.highlightMultipleSavedLines === 'function') {
                            MapManager.highlightMultipleSavedLines(toHighlight);
                        }
                    } else if (typeof MapManager.highlightSavedLine === 'function') {
                        MapManager.highlightSavedLine(line.id);
                    }
                });
                item.addEventListener('mouseleave', () => {
                    if (typeof MapManager === 'undefined' || !MapManager) return;
                    const selectedIds = Array.from(this.ui.linesList.querySelectorAll('.line-select-checkbox:checked'))
                        .map(cb => String(cb.getAttribute('data-id')))
                        .filter(id => id != null);
                    if (selectedIds.length > 0) {
                        if (typeof MapManager.highlightMultipleSavedLines === 'function') {
                            MapManager.highlightMultipleSavedLines(selectedIds);
                        }
                    } else if (typeof MapManager.clearSavedHighlight === 'function') {
                        MapManager.clearSavedHighlight();
                    }
                });

                // Add click-to-focus event
                item.addEventListener('click', () => {
                    const temp = L.geoJSON(line);
                    try {
                        MapManager.map.fitBounds(temp.getBounds(), {
                            // Sidebar is on the left, so reserve padding there
                            paddingTopLeft: [450, 50],
                            paddingBottomRight: [50, 50],
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
    },

    /**
     * Update map highlighting based on which saved routes are selected
     * for merging.
     */
    updateMergeSelectionHighlight() {
        const checkboxNodes = this.ui.linesList.querySelectorAll('.line-select-checkbox');
        const checkboxes = Array.from(checkboxNodes);
        const selectedIds = checkboxes
            .filter(cb => cb.checked)
            .map(cb => String(cb.getAttribute('data-id')))
            .filter(id => id != null);

        if (!MapManager || typeof MapManager.clearSavedHighlight !== 'function') {
            return;
        }

        if (selectedIds.length === 0) {
            MapManager.clearSavedHighlight();
            return;
        }

        if (typeof MapManager.highlightMultipleSavedLines === 'function') {
            MapManager.highlightMultipleSavedLines(selectedIds);
        }
    },

    /**
     * Merge the geometries of the selected saved routes into a new single route.
     */
    mergeSelectedRoutes() {
        const checkboxNodes = this.ui.linesList.querySelectorAll('.line-select-checkbox:checked');
        const checkboxes = Array.from(checkboxNodes);

        if (checkboxes.length === 0) {
            this.showToast('Select at least two routes to merge.');
            return;
        }
        if (checkboxes.length < 2) {
            this.showToast('Select at least two routes to merge.');
            return;
        }

        const selectedIds = checkboxes.map(cb => String(cb.getAttribute('data-id')));
        const allLines = Storage.getLines();
        const selectedLines = selectedIds
            .map(id => allLines.find(l => String(l.id) === id))
            .filter(Boolean);

        if (selectedLines.length < 2) {
            this.showToast('Could not find the selected routes.');
            return;
        }

        const lineParts = [];

        selectedLines.forEach((line) => {
            const geom = line && line.geometry;
            if (!geom || !Array.isArray(geom.coordinates)) return;

            if (geom.type === 'LineString') {
                if (geom.coordinates.length >= 2) {
                    lineParts.push(geom.coordinates);
                }
            } else if (geom.type === 'MultiLineString') {
                geom.coordinates.forEach(part => {
                    if (Array.isArray(part) && part.length >= 2) {
                        lineParts.push(part);
                    }
                });
            }
        });

        if (lineParts.length === 0) {
            this.showToast('Could not build a merged route from the selected items.');
            return;
        }

        const firstLine = selectedLines[0];
        const firstProps = firstLine.properties || {};
        const defaultTitle = firstProps.displayName
            || (firstProps.from && firstProps.to ? `${firstProps.from} ➔ ${firstProps.to}` : (firstProps.name || 'Merged route'));

        const nameInput = prompt('Name the merged route:', defaultTitle) || defaultTitle;
        const trimmedName = (nameInput || '').trim() || defaultTitle;

        const id = `merged-${Date.now()}`;
        const geometry =
            lineParts.length === 1
                ? {
                    type: 'LineString',
                    coordinates: lineParts[0]
                }
                : {
                    type: 'MultiLineString',
                    coordinates: lineParts
                };

        const mergedFeature = {
            type: 'Feature',
            id: id,
            properties: {
                ...firstProps,
                id: id,
                displayName: trimmedName,
                source: 'merged',
                mergedFromIds: selectedLines.map(l => l.id)
            },
            geometry
        };

        const added = Storage.saveLine(mergedFeature);
        if (added) {
            selectedIds.forEach(rid => Storage.removeLine(rid));
            this.showToast(`Merged into ${trimmedName}`);
        } else {
            this.showToast(`${trimmedName} is already saved`);
        }

        this.updateSavedUI();
    },

    swapStations() {
        const prevStartStation = this.state.startStation;
        const prevEndStation = this.state.endStation;

        // Swap state objects
        this.state.startStation = prevEndStation;
        this.state.endStation = prevStartStation;

        // Swap input values (fall back to empty string if null)
        const startName = this.state.startStation ? this.state.startStation.name : '';
        const endName = this.state.endStation ? this.state.endStation.name : '';

        this.ui.inputStart.value = startName;
        this.ui.inputEnd.value = endName;

        // Optionally, re-center the map on the new start station
        if (this.state.startStation) {
            MapManager.map.setView(
                [this.state.startStation.lat, this.state.startStation.lon],
                13
            );
        }

        this.updateSearchBtnState();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();

    // When routes change from external integrations (e.g. Google Drive sync),
    // refresh the UI so new lines appear without requiring a manual reload.
    window.addEventListener('trainTrackerLinesChanged', () => {
        App.updateSavedUI();
    });
});
