const MapManager = {
    map: null,
    tempLayer: null,
    savedLayers: null,
    railwayOverlay: null,
    railwayOverlayVisible: false,
    // Manual drawing state for user-defined routes
    isDrawingManual: false,
    manualPoints: [],
    manualLayer: null,
    manualClickHandler: null,
    manualMoveHandler: null,
    manualAnchors: [],
    manualAnchorMarkers: [],
    manualPreviewLayer: null,
    manualHoverMarker: null,
    lastPreviewTs: 0,

    // Preloaded railway network from local GeoJSON tiles
    railNodes: [],
    railAdj: [],
    railNodeIndexByKey: {},
    railReady: false,
    railLoading: false,
    railLoadPromise: null,
    railTilesLoaded: new Set(),

    init() {
        // Initialize the map, centered on Switzerland
        this.map = L.map('map', {
            zoomControl: false, // We reposition it in CSS
            scrollWheelZoom: false, // Disable default zoom
            smoothWheelZoom: true,  // Enable smooth zoom plugin
            smoothSensitivity: 5,   // Higher is faster
        }).setView([46.8182, 8.2275], 8);

        // 1. Add CartoDB Positron 'no labels' base layer
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        }).addTo(this.map);

        // 2. Add CartoDB Positron labels. This restores the clean SBB-like font.
        // Note: This layer will unfortunately bring back region names, but it resolves the ugly font and white flashing.
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
            maxZoom: 20,
            attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
        }).addTo(this.map);

        // 3. Prepare OpenRailwayMap overlay (infrastructure lines). This is toggled via UI.
        this.railwayOverlay = L.tileLayer(
            'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
            {
                maxZoom: 19,
                opacity: 0.8,
                attribution:
                    '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> contributors'
            }
        );

        // Reposition zoom control
        L.control.zoom({
            position: 'topright'
        }).addTo(this.map);

        // Layer group for saved lines
        this.savedLayers = L.featureGroup().addTo(this.map);

        // Railway network is loaded lazily from tiles when needed.
    },

    /**
     * Load railway tiles for the current map bounds and build/extend the
     * graph of unique nodes and adjacency lists. Tiles are 1°×1° and are
     * stored under data/tiles/<lat>_<lon>.geojson.
     */
    async loadRailTilesForBounds(bounds) {
        if (!bounds) return;

        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const pad = 0.5; // Load a bit beyond current view
        const minLat = Math.floor(sw.lat - pad);
        const maxLat = Math.floor(ne.lat + pad);
        const minLon = Math.floor(sw.lng - pad);
        const maxLon = Math.floor(ne.lng + pad);

        const promises = [];

        for (let lat = minLat; lat <= maxLat; lat++) {
            for (let lon = minLon; lon <= maxLon; lon++) {
                const key = `${lat}_${lon}`;
                if (this.railTilesLoaded.has(key)) continue;
                this.railTilesLoaded.add(key);

                const url = `data/tiles/${key}.geojson`;
                promises.push(
                    fetch(url)
                        .then((res) => {
                            if (!res.ok) {
                                // Tile might simply not exist for this region.
                                return null;
                            }
                            return res.json();
                        })
                        .then((data) => {
                            if (!data || !Array.isArray(data.features)) return;
                            this._addRailFeaturesToGraph(data.features);
                        })
                        .catch(() => { /* ignore errors per-tile */ })
                );
            }
        }

        if (promises.length === 0) return;
        this.railLoading = true;
        await Promise.all(promises);
        this.railLoading = false;
        this.railReady = this.railNodes.length > 0;
    },

    _addRailFeaturesToGraph(features) {
        if (!features || features.length === 0) return;

        const nodes = this.railNodes;
        const adj = this.railAdj;
        const nodeIndexByKey = this.railNodeIndexByKey;

        const addEdge = (a, b) => {
            if (a === b) return;
            if (!adj[a]) adj[a] = [];
            if (!adj[b]) adj[b] = [];
            adj[a].push(b);
            adj[b].push(a);
        };

        features.forEach((f) => {
            if (!f || !f.geometry || f.geometry.type !== 'LineString') return;
            const coords = f.geometry.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) return;

            let prevIdx = null;
            coords.forEach((coord) => {
                if (!Array.isArray(coord) || coord.length < 2) return;
                const lon = coord[0];
                const lat = coord[1];
                const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
                let idx = nodeIndexByKey[key];
                if (idx === undefined) {
                    idx = nodes.length;
                    nodeIndexByKey[key] = idx;
                    nodes.push({ lat, lon });
                    adj[idx] = [];
                }
                if (prevIdx !== null) {
                    addEdge(prevIdx, idx);
                }
                prevIdx = idx;
            });
        });
    },

    clearTempLine() {
        if (this.tempLayer) {
            this.map.removeLayer(this.tempLayer);
            this.tempLayer = null;
        }
    },

    drawTempLine(geoJsonFeature) {
        this.clearTempLine();

        // Ensure GeoJSON is valid before drawing
        if (!geoJsonFeature || !geoJsonFeature.geometry || !geoJsonFeature.geometry.coordinates) {
            console.error("Invalid GeoJSON passed to drawTempLine", geoJsonFeature);
            return;
        }

        this.tempLayer = L.geoJSON(geoJsonFeature, {
            style: {
                color: '#EB0000', // SBB Red
                weight: 6,
                opacity: 0.6,
                dashArray: '5, 10' // Pulsing/dashed effect for preview
            }
        }).addTo(this.map);

        // Fit map to show the line
        try {
            this.map.fitBounds(this.tempLayer.getBounds(), {
                // Sidebar is on the left, so reserve padding there
                paddingTopLeft: [450, 50],
                paddingBottomRight: [50, 50]
            });
        } catch (e) {
            console.warn("Could not fit bounds for temp layer", e);
        }
    },

    renderSavedLines(lines) {
        this.savedLayers.clearLayers();

        lines.forEach(line => {
            if (!line || !line.geometry) return;

            L.geoJSON(line, {
                style: {
                    color: '#EB0000', // SBB Red
                    weight: 5,
                    opacity: 1.0, // Solid line for saved
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(this.savedLayers);
        });
    },

    setRailwayOverlayVisible(visible) {
        this.railwayOverlayVisible = visible;

        if (!this.railwayOverlay) return;

        if (visible) {
            if (!this.map.hasLayer(this.railwayOverlay)) {
                this.railwayOverlay.addTo(this.map);
            }
        } else if (this.map.hasLayer(this.railwayOverlay)) {
            this.map.removeLayer(this.railwayOverlay);
        }
    },

    /**
     * Find index of nearest railway node to the given lat/lon.
     */
    findNearestRailNode(lat, lon) {
        if (!this.railReady || !this.railNodes || this.railNodes.length === 0) {
            return null;
        }

        let bestIdx = null;
        let bestDist = Infinity;

        for (let i = 0; i < this.railNodes.length; i++) {
            const n = this.railNodes[i];
            const dLat = lat - n.lat;
            const dLon = lon - n.lon;
            const dist2 = dLat * dLat + dLon * dLon;
            if (dist2 < bestDist) {
                bestDist = dist2;
                bestIdx = i;
            }
        }

        return bestIdx;
    },

    /**
     * Build a path along the railway graph between two geographic points.
     * Returns an array of { lat, lon } or null if no path can be found.
     */
    buildRailPath(latFrom, lonFrom, latTo, lonTo) {
        if (!this.railReady) return null;

        const nodes = this.railNodes;
        const adj = this.railAdj;
        if (!nodes || !adj || nodes.length === 0) return null;

        const startIdx = this.findNearestRailNode(latFrom, lonFrom);
        const endIdx = this.findNearestRailNode(latTo, lonTo);
        if (startIdx === null || endIdx === null) return null;
        if (startIdx === endIdx) {
            return [nodes[startIdx]];
        }

        const prev = new Array(nodes.length).fill(-1);
        const queue = [];
        let head = 0;

        queue.push(startIdx);
        prev[startIdx] = startIdx;

        while (head < queue.length) {
            const current = queue[head++];
            if (current === endIdx) break;
            const neighbors = adj[current] || [];
            for (let i = 0; i < neighbors.length; i++) {
                const nb = neighbors[i];
                if (prev[nb] !== -1) continue;
                prev[nb] = current;
                queue.push(nb);
            }
        }

        if (prev[endIdx] === -1) {
            console.warn('No rail path between nodes', { startIdx, endIdx });
            return null;
        }

        const pathIdxs = [];
        let cur = endIdx;
        while (cur !== prev[cur]) {
            pathIdxs.push(cur);
            cur = prev[cur];
        }
        // push start
        pathIdxs.push(startIdx);
        pathIdxs.reverse();

        return pathIdxs.map((idx) => nodes[idx]);
    },

    /**
     * Enable manual drawing mode so the user can click along the map to
     * trace a custom route. Each click is snapped to the nearest railway
     * node and the path between clicks follows real track geometry.
     */
    async startManualDraw() {
        if (!this.map) return;

        // Ensure the railway tiles for the current view are loaded before we start.
        await this.loadRailTilesForBounds(this.map.getBounds());
        if (!this.railReady) {
            console.warn('Cannot start manual draw: railway network not ready');
            return;
        }

        // If already drawing, reset first
        if (this.isDrawingManual) {
            this.cancelManualDraw();
        }

        this.isDrawingManual = true;
        this.manualPoints = [];
        this.manualAnchors = [];
        this.lastPreviewTs = 0;

        if (this.manualLayer) {
            this.map.removeLayer(this.manualLayer);
            this.manualLayer = null;
        }
        if (this.manualPreviewLayer) {
            this.map.removeLayer(this.manualPreviewLayer);
            this.manualPreviewLayer = null;
        }
        if (this.manualHoverMarker) {
            this.map.removeLayer(this.manualHoverMarker);
            this.manualHoverMarker = null;
        }
        if (this.manualAnchorMarkers && this.manualAnchorMarkers.length > 0) {
            this.manualAnchorMarkers.forEach(m => this.map.removeLayer(m));
            this.manualAnchorMarkers = [];
        }

        // Click handler: commit the currently previewed segment and add a
        // new anchor (filled circle) at the snapped railway node.
        this.manualClickHandler = (e) => {
            const latlng = e.latlng;
            if (!latlng) return;

            const snappedIdx = this.findNearestRailNode(latlng.lat, latlng.lng);
            if (snappedIdx === null) return;
            const snapped = this.railNodes[snappedIdx];
            const snappedLatLng = L.latLng(snapped.lat, snapped.lon);

            // First anchor: just start the route here.
            if (this.manualAnchors.length === 0) {
                this.manualAnchors.push(snappedLatLng);
                this.manualPoints = [snappedLatLng];

                const marker = L.circleMarker(snappedLatLng, {
                    radius: 5,
                    color: '#EB0000',
                    fillColor: '#EB0000',
                    fillOpacity: 1,
                    weight: 1
                }).addTo(this.map);
                // Clicking an anchor while drawing should finish the route.
                marker.on('click', (evt) => {
                    if (evt && evt.originalEvent) {
                        evt.originalEvent.preventDefault();
                        evt.originalEvent.stopPropagation();
                    }
                    if (this.isDrawingManual && typeof App !== 'undefined' && App && typeof App.toggleManualDraw === 'function') {
                        App.toggleManualDraw();
                    }
                });
                this.manualAnchorMarkers.push(marker);
            } else {
                const lastAnchor = this.manualAnchors[this.manualAnchors.length - 1];
                const segment = this.buildRailPath(lastAnchor.lat, lastAnchor.lng, snapped.lat, snapped.lon);
                if (!segment || segment.length < 2) {
                    console.warn('Could not build rail segment for click', {
                        from: lastAnchor,
                        to: snapped
                    });
                    return;
                }

                segment.forEach((node, idx) => {
                    // Skip the first node so we don't duplicate the junction
                    if (idx === 0 && this.manualPoints.length > 0) return;
                    this.manualPoints.push(L.latLng(node.lat, node.lon));
                });

                this.manualAnchors.push(snappedLatLng);

                const marker = L.circleMarker(snappedLatLng, {
                    radius: 5,
                    color: '#EB0000',
                    fillColor: '#EB0000',
                    fillOpacity: 1,
                    weight: 1
                }).addTo(this.map);
                marker.on('click', (evt) => {
                    if (evt && evt.originalEvent) {
                        evt.originalEvent.preventDefault();
                        evt.originalEvent.stopPropagation();
                    }
                    if (this.isDrawingManual && typeof App !== 'undefined' && App && typeof App.toggleManualDraw === 'function') {
                        App.toggleManualDraw();
                    }
                });
                this.manualAnchorMarkers.push(marker);
            }

            if (!this.manualLayer) {
                this.manualLayer = L.polyline(this.manualPoints, {
                    color: '#EB0000',
                    weight: 5,
                    opacity: 0.9,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(this.map);
            } else {
                this.manualLayer.setLatLngs(this.manualPoints);
            }

            // Once we've committed a segment, clear the preview. It will be
            // recomputed on the next mouse move.
            if (this.manualPreviewLayer) {
                this.map.removeLayer(this.manualPreviewLayer);
                this.manualPreviewLayer = null;
            }
        };

        // Mouse move handler: show a dashed preview segment and a hollow
        // red circle following the cursor, both snapped to the railway.
        this.manualMoveHandler = (e) => {
            if (!this.isDrawingManual) return;
            if (!this.manualAnchors || this.manualAnchors.length === 0) return;

            const now = Date.now();
            if (now - this.lastPreviewTs < 40) {
                return;
            }
            this.lastPreviewTs = now;

            const latlng = e.latlng;
            if (!latlng) return;

            const snappedIdx = this.findNearestRailNode(latlng.lat, latlng.lng);
            if (snappedIdx === null) return;
            const snapped = this.railNodes[snappedIdx];

            const lastAnchor = this.manualAnchors[this.manualAnchors.length - 1];
            const segment = this.buildRailPath(lastAnchor.lat, lastAnchor.lng, snapped.lat, snapped.lon);
            if (!segment || segment.length < 2) {
                return;
            }

            const previewLatLngs = segment.map(node => L.latLng(node.lat, node.lon));

            if (!this.manualPreviewLayer) {
                this.manualPreviewLayer = L.polyline(previewLatLngs, {
                    color: '#EB0000',
                    weight: 4,
                    opacity: 0.7,
                    dashArray: '5,8',
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(this.map);
            } else {
                this.manualPreviewLayer.setLatLngs(previewLatLngs);
            }

            const end = previewLatLngs[previewLatLngs.length - 1];
            if (!this.manualHoverMarker) {
                this.manualHoverMarker = L.circleMarker(end, {
                    radius: 6,
                    color: '#EB0000',
                    fillColor: '#FFFFFF',
                    fillOpacity: 0,
                    weight: 2
                }).addTo(this.map);
            } else {
                this.manualHoverMarker.setLatLng(end);
            }
        };

        this.map.on('click', this.manualClickHandler);
        this.map.on('mousemove', this.manualMoveHandler);

        // Make double-click less surprising while drawing
        if (this.map.doubleClickZoom && this.map.doubleClickZoom.enabled()) {
            this.map.doubleClickZoom.disable();
        }
    },

    /**
     * Return the currently drawn manual route as an array of raw LatLng
     * points (Leaflet objects). Used as input for snapping to real
     * railway geometry.
     */
    getManualDrawPoints() {
        if (!this.isDrawingManual || !this.manualPoints || this.manualPoints.length === 0) {
            return [];
        }
        return [...this.manualPoints];
    },

    /**
     * Return the currently drawn manual route as an array of [lon, lat]
     * coordinate pairs suitable for GeoJSON. This reflects the raw
     * click positions, not yet snapped to railway tracks.
     */
    getManualDrawCoordinates() {
        if (!this.isDrawingManual || !this.manualPoints || this.manualPoints.length === 0) {
            return [];
        }

        return this.manualPoints.map((pt) => [pt.lng, pt.lat]);
    },

    /**
     * Cancel manual drawing mode and clear any temporary polyline from the map.
     */
    cancelManualDraw() {
        if (!this.map) return;

        if (this.manualClickHandler) {
            this.map.off('click', this.manualClickHandler);
            this.manualClickHandler = null;
        }
        if (this.manualMoveHandler) {
            this.map.off('mousemove', this.manualMoveHandler);
            this.manualMoveHandler = null;
        }

        if (this.manualLayer) {
            this.map.removeLayer(this.manualLayer);
            this.manualLayer = null;
        }
        if (this.manualPreviewLayer) {
            this.map.removeLayer(this.manualPreviewLayer);
            this.manualPreviewLayer = null;
        }
        if (this.manualHoverMarker) {
            this.map.removeLayer(this.manualHoverMarker);
            this.manualHoverMarker = null;
        }
        if (this.manualAnchorMarkers && this.manualAnchorMarkers.length > 0) {
            this.manualAnchorMarkers.forEach(m => this.map.removeLayer(m));
            this.manualAnchorMarkers = [];
        }

        this.manualPoints = [];
        this.manualAnchors = [];
        this.isDrawingManual = false;

        if (this.map.doubleClickZoom && !this.map.doubleClickZoom.enabled()) {
            this.map.doubleClickZoom.enable();
        }
    }
};
