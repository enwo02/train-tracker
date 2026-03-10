const MapManager = {
    map: null,
    tempLayer: null,
    savedLayers: null,
    // Keep track of each saved route layer by its id so we can
    // highlight individual routes from the sidebar.
    savedLayerById: {},
    highlightedSavedId: null,
    highlightedMultipleIds: null,
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
    // Debug layer for visualizing all stored geometry points
    debugPointsLayer: null,

    // Eraser Tool state
    isErasing: false,
    eraserFeature: null,
    eraserLayer: null,
    eraserBrushLayer: null,
    eraserBrushRadius: 30, // px radius
    eraserMoveHandler: null,
    eraserDownHandler: null,
    eraserUpHandler: null,
    eraserIsDown: false,
    eraserUpGlobalHandler: null,
    
    // Eraser Tool state
    isErasing: false,
    eraserFeature: null,
    eraserLayer: null,
    eraserBrushLayer: null,
    eraserBrushRadius: 30, // px radius
    eraserMoveHandler: null,
    eraserDownHandler: null,
    eraserUpHandler: null,
    eraserIsDown: false,


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

        // 1. Base map layers (user picks one)
        const baseMapLight = L.layerGroup([
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            }),
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
                maxZoom: 20,
                attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
            })
        ]);

        const baseMapVoyager = L.layerGroup([
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            }),
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
                maxZoom: 20,
                attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
            })
        ]);

        const baseMapOSM = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });

        const baseMapDarkMatter = L.layerGroup([
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            }),
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
                maxZoom: 20,
                attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>'
            })
        ]);

        const baseMapTerrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM &copy; <a href="https://opentopomap.org/">OpenTopoMap</a> (CC-BY-SA)'
        });

        // 2. OpenRailwayMap overlay (toggleable via layer control)
        this.railwayOverlay = L.tileLayer(
            'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
            {
                maxZoom: 19,
                opacity: 0.8,
                attribution:
                    '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> contributors'
            }
        );

        // 3. Layer control: base map (radio) + overlay (checkbox)
        // On mobile we keep it collapsed so it doesn't take much space.
        const mapboxToken = 'pk.eyJ1IjoiZW53bzAyIiwiYSI6ImNtbWwxNTQwaTFweGEycnM1eWV1cGtxamMifQ.r68RH710JkBoG2eyaqTrdw';
        // Note: Change 'mapbox/light-v11' to your custom style ID (e.g. 'enwo02/customstyleid') once you hide counties in Mapbox Studio
        //const baseMapMapbox = L.tileLayer(`https://api.mapbox.com/styles/v1/enwo02/cmml25g86004001s7bpfg1hun/tiles/256/{z}/{x}/{y}@2x?access_token=${mapboxToken}`, {
        const baseMapMapbox = L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${mapboxToken}`, {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(this.map); // Set Mapbox as default

        // Layer group for saved lines
        this.savedLayers = L.featureGroup().addTo(this.map);

        const isMobile = window.innerWidth <= 768;
        L.control.layers(
            {
                'Mapbox (Light)': baseMapMapbox,
                'Voyager (Colorful)': baseMapVoyager,
                'Light (Muted)': baseMapLight,
                'Dark Matter': baseMapDarkMatter,
                'OpenStreetMap': baseMapOSM,
                'Terrain': baseMapTerrain
            },
            {
                'Railway lines': this.railwayOverlay,
                'My Routes': this.savedLayers
            },
            {
                position: 'topright',
                collapsed: isMobile
            }
        ).addTo(this.map);

        // Reposition zoom control
        L.control.zoom({
            position: 'topright'
        }).addTo(this.map);

        this.map.on('zoomend', () => {
            this.updateRouteStyles();
        });

        // Railway network is loaded lazily from tiles when needed.
    },

    getDynamicWeight() {
        if (!this.map) return 4;
        const zoom = this.map.getZoom();
        const baseZoom = 8;
        const baseWeight = 4;
        
        // We only scale extremely slightly when zooming in,
        // and reduce thickness smoothly when zooming out.
        const scaleFactor = 1.05;
        
        const weight = baseWeight * Math.pow(scaleFactor, zoom - baseZoom);
        
        // Clamp between 2px (so we can still see lines zoomed out)
        // and a very modest 5px (barely thicker than base zoom).
        return Math.max(1, Math.min(weight, 5));
    },

    updateRouteStyles() {
        const weight = this.getDynamicWeight();
        
        // Update temp layer
        if (this.tempLayer) {
            this.tempLayer.setStyle({ weight: weight + 1 });
        }

        // Update manual draw layers
        if (this.manualLayer) {
            this.manualLayer.setStyle({ weight: weight });
        }
        if (this.manualPreviewLayer) {
            this.manualPreviewLayer.setStyle({ weight: Math.max(1, weight - 1) });
        }
        
        if (!this.savedLayerById) return;

        const defaultStyle = {
            weight: weight,
        };
        const dimStyle = {
            weight: Math.max(1, weight - 1),
        };
        const highlightStyle = {
            weight: weight + 2,
        };

        Object.entries(this.savedLayerById).forEach(([key, layer]) => {
            if (!layer || typeof layer.setStyle !== 'function') return;
            
            let applyStyle = defaultStyle;
            if (this.highlightedSavedId && key === this.highlightedSavedId) {
                applyStyle = highlightStyle;
            } else if (this.highlightedMultipleIds && this.highlightedMultipleIds.has(key)) {
                applyStyle = highlightStyle;
            } else if (this.highlightedSavedId || this.highlightedMultipleIds) {
                applyStyle = dimStyle;
            }

            layer.setStyle(applyStyle);
        });
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

        const weight = this.getDynamicWeight();

        this.tempLayer = L.geoJSON(geoJsonFeature, {
            style: {
                color: '#EB0000', // SBB Red
                weight: weight + 1,
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
        this.savedLayerById = {};
        this.highlightedSavedId = null;
        this.highlightedMultipleIds = null;

        const weight = this.getDynamicWeight();

        const defaultStyle = {
            color: '#EB0000', // SBB Red
            weight: weight,
            opacity: 1.0, // Solid line for saved
            lineCap: 'round',
            lineJoin: 'round'
        };

        lines.forEach(line => {
            if (!line || !line.geometry) return;

            const layer = L.geoJSON(line, {
                style: defaultStyle
            }).addTo(this.savedLayers);

            // Add click listener
            layer.on('click', (e) => {
                L.DomEvent.stopPropagation(e); // prevent clicking through to the map
                
                // Allow the App controller to handle selecting this line in the UI
                if (typeof App !== 'undefined' && App && typeof App.focusSavedRoute === 'function') {
                    App.focusSavedRoute(line.id);
                }
            });

            if (line.id != null) {
                this.savedLayerById[line.id] = layer;
            }
        });
    },

    /**
     * Visually highlight a saved route by id. Used when hovering
     * over route cards in the sidebar.
     */
    highlightSavedLine(id) {
        if (!id || !this.savedLayerById) return;

        const weight = this.getDynamicWeight();

        const dimStyle = {
            color: '#EB0000',
            weight: Math.max(1, weight - 1),
            opacity: 0.35,
            lineCap: 'round',
            lineJoin: 'round'
        };
        const highlightStyle = {
            color: '#EB0000',
            weight: weight + 2,   // slightly thicker than default
            opacity: 1.0,
            lineCap: 'round',
            lineJoin: 'round'
        };

        Object.entries(this.savedLayerById).forEach(([key, layer]) => {
            if (!layer || typeof layer.setStyle !== 'function') return;

            if (key === String(id)) {
                layer.setStyle(highlightStyle);
                if (typeof layer.bringToFront === 'function') {
                    layer.bringToFront();
                }
            } else {
                layer.setStyle(dimStyle);
            }
        });

        this.highlightedSavedId = String(id);
        this.highlightedMultipleIds = null;
    },

    /**
     * Visually highlight multiple saved routes by id. Used when selecting
     * routes for merging so you can see which segments will be combined.
     */
    highlightMultipleSavedLines(ids) {
        if (!ids || !Array.isArray(ids) || !this.savedLayerById) return;

        const selected = new Set(ids.map(id => String(id)));
        const weight = this.getDynamicWeight();

        const dimStyle = {
            color: '#EB0000',
            weight: Math.max(1, weight - 1),
            opacity: 0.35,
            lineCap: 'round',
            lineJoin: 'round'
        };
        const highlightStyle = {
            color: '#EB0000',
            weight: weight + 2,
            opacity: 1.0,
            lineCap: 'round',
            lineJoin: 'round'
        };

        Object.entries(this.savedLayerById).forEach(([key, layer]) => {
            if (!layer || typeof layer.setStyle !== 'function') return;

            if (selected.has(String(key))) {
                layer.setStyle(highlightStyle);
                if (typeof layer.bringToFront === 'function') {
                    layer.bringToFront();
                }
            } else {
                layer.setStyle(dimStyle);
            }
        });

        this.highlightedSavedId = null;
        this.highlightedMultipleIds = selected;
    },

    /**
     * Clear any saved route highlight, restoring default styles.
     */
    clearSavedHighlight() {
        if (!this.savedLayerById) return;

        const weight = this.getDynamicWeight();

        const defaultStyle = {
            color: '#EB0000',
            weight: weight,
            opacity: 1.0,
            lineCap: 'round',
            lineJoin: 'round'
        };

        Object.values(this.savedLayerById).forEach(layer => {
            if (layer && typeof layer.setStyle === 'function') {
                layer.setStyle(defaultStyle);
            }
        });

        this.highlightedSavedId = null;
        this.highlightedMultipleIds = null;
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
                    weight: this.getDynamicWeight(),
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
                    weight: Math.max(1, this.getDynamicWeight() - 1),
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
    },

    /**
     * Start the Eraser tool on a given feature.
     */
    startEraser(feature) {
        if (!this.map || !feature) return;

        this.isErasing = true;
        this.eraserFeature = JSON.parse(JSON.stringify(feature)); // deep clone
        
        // Dim all other lines drastically to put focus on the erasing
        if (this.savedLayerById) {
            Object.values(this.savedLayerById).forEach(layer => {
                if (layer && typeof layer.setStyle === 'function') {
                    layer.setStyle({ opacity: 0.1 });
                }
            });
        }
        
        // We will maintain this geometry as lines are brushed away.
        // It should be represented as a unified set of lines (Array of Coordinate Arrays)
        // so it's simple to split.
        let lines = [];
        const geom = this.eraserFeature.geometry;
        if (geom.type === 'LineString') {
            lines = [geom.coordinates];
        } else if (geom.type === 'MultiLineString') {
            lines = geom.coordinates;
        }
        this.eraserFeature.geometry = {
            type: 'MultiLineString',
            coordinates: lines
        };
        
        // Setup Eraser Layer showing the active geometry in a distinct color (e.g. Blue)
        this.eraserLayer = L.geoJSON(this.eraserFeature, {
            interactive: false,
            style: {
                color: '#0070f3', // Blue color to indicate editing mode
                weight: this.getDynamicWeight() + 2,
                opacity: 1.0,
                lineCap: 'round',
                lineJoin: 'round'
            }
        }).addTo(this.map);
        
        if (this.eraserLayer && typeof this.eraserLayer.bringToFront === 'function') {
            this.eraserLayer.bringToFront();
        }

        // Setup the Brush crosshair
        this.eraserBrushLayer = L.circleMarker([0,0], {
            radius: this.eraserBrushRadius, // pixel radius
            color: '#111',
            weight: 2,
            fillColor: '#ffffff',
            fillOpacity: 0.4,
            interactive: false
        }).addTo(this.map);

        document.body.classList.add('eraser-mode');

        this.eraserMoveHandler = (e) => {
            if (!this.isErasing) return;
            const latlng = e.latlng;
            this.eraserBrushLayer.setLatLng(latlng);

            if (this.eraserIsDown) {
                this.eraseAtPoint(latlng);
            }
        };

        this.eraserDownHandler = (e) => {
            if (!this.isErasing) return;
            // Left click only
            if (e.originalEvent.button !== 0) return;
            
            // Re-sync dragging logic. Disable default dragging temporarily while erasing.
            this.map.dragging.disable();
            this.eraserIsDown = true;
            this.eraseAtPoint(e.latlng);
        };

        this.eraserUpHandler = (e) => {
            if (!this.isErasing) return;
            if (e.originalEvent.button !== 0) return;
            
            this.eraserIsDown = false;
            this.map.dragging.enable();
        };

        this.eraserUpGlobalHandler = () => {
            if (this.isErasing && typeof this.map !== 'undefined' && this.map) {
                this.eraserIsDown = false;
                if (this.map.dragging) {
                    this.map.dragging.enable();
                }
            }
        };

        this.map.on('mousemove', this.eraserMoveHandler);
        this.map.on('mousedown', this.eraserDownHandler);
        this.map.on('mouseup', this.eraserUpHandler);
        
        // Safety bounds
        document.addEventListener('mouseup', this.eraserUpGlobalHandler);
    },

    /**
     * Erases any path segment within the brush radius.
     */
    eraseAtPoint(latlng) {
        if (!this.eraserFeature || !this.eraserFeature.geometry) return;
        
        const centerPt = this.map.latLngToContainerPoint(latlng);
        let updatedLines = [];
        let didChange = false;

        const lines = this.eraserFeature.geometry.coordinates;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let currentValidSegment = [];

            for (let j = 0; j < line.length; j++) {
                const coord = line[j];
                const ptLatLng = L.latLng(coord[1], coord[0]);
                const pt = this.map.latLngToContainerPoint(ptLatLng);
                
                // Distance to brush center
                const dist = centerPt.distanceTo(pt);

                if (dist <= this.eraserBrushRadius) {
                    // This point is inside the brush and should be erased.
                    if (currentValidSegment.length > 0) {
                        // We hit an erased point, so our valid segment ends.
                        // We only keep segments with >= 2 points to draw a line.
                        if (currentValidSegment.length >= 2) {
                            updatedLines.push(currentValidSegment);
                        }
                        currentValidSegment = [];
                    }
                    didChange = true;
                } else {
                    // Valid point, inside the current accumulated segment
                    currentValidSegment.push(coord);
                    
                    // We also need to check the segment *between* points to robustly break lines
                    // even if the vertices themselves are outside the brush.
                    if (j > 0 && currentValidSegment.length >= 2) {
                        const prevCoord = line[j - 1];
                        const ptPrevLatLng = L.latLng(prevCoord[1], prevCoord[0]);
                        const ptPrev = this.map.latLngToContainerPoint(ptPrevLatLng);
                        
                        // Distance from brush center to segment connecting pt and ptPrev
                        const distToSegment = L.LineUtil.pointToSegmentDistance(centerPt, ptPrev, pt);
                        
                        // If segment intersects brush, break it strictly here.
                        if (distToSegment <= this.eraserBrushRadius && dist > this.eraserBrushRadius && centerPt.distanceTo(ptPrev) > this.eraserBrushRadius) {
                           // The line connecting these two points passes through the brush.
                           // Discard the previous point from our *next* piece, the line is broken!
                           // Pop the current point we just pushed to use it to start the NEXT segment
                           currentValidSegment.pop();
                           
                           if (currentValidSegment.length >= 2) {
                               updatedLines.push(currentValidSegment);
                           }
                           
                           currentValidSegment = [coord]; // Start a new piece starting from this current point
                           didChange = true;
                        }
                    }
                }
            }

            if (currentValidSegment.length >= 2) {
                updatedLines.push(currentValidSegment);
            }
        }

        if (didChange) {
            this.eraserFeature.geometry.coordinates = updatedLines;
            
            // Redraw eraser layer
            this.map.removeLayer(this.eraserLayer);
            this.eraserLayer = L.geoJSON(this.eraserFeature, {
                interactive: false,
                style: {
                    color: '#0070f3', // Keep it blue while editing
                    weight: this.getDynamicWeight() + 2,
                    opacity: 1.0,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(this.map);
            if (this.eraserLayer && typeof this.eraserLayer.bringToFront === 'function') {
                this.eraserLayer.bringToFront();
            }
        }
    },

    /**
     * Restore standard view and remove eraser events without returning the modified object.
     */
    cancelEraser() {
        this._cleanupEraser();
        // Return visibility to the regular layer
        this.clearSavedHighlight(); 
    },

    /**
     * Restore standard view and return the modified feature.
     */
    finishEraser() {
        const feature = this.eraserFeature;
        this._cleanupEraser();
        // Restore standard visibility
        this.clearSavedHighlight();
        return feature;
    },

    _cleanupEraser() {
        if (!this.map) return;
        this.isErasing = false;

        document.removeEventListener('mouseup', this.eraserUpGlobalHandler);

        if (this.eraserMoveHandler) {
            this.map.off('mousemove', this.eraserMoveHandler);
            this.eraserMoveHandler = null;
        }
        if (this.eraserDownHandler) {
            this.map.off('mousedown', this.eraserDownHandler);
            this.eraserDownHandler = null;
        }
        if (this.eraserUpHandler) {
            this.map.off('mouseup', this.eraserUpHandler);
            this.eraserUpHandler = null;
        }
        if (this.eraserBrushLayer) {
            this.map.removeLayer(this.eraserBrushLayer);
            this.eraserBrushLayer = null;
        }
        if (this.eraserLayer) {
             this.map.removeLayer(this.eraserLayer);
             this.eraserLayer = null;
        }
        this.eraserFeature = null;
        this.eraserIsDown = false;
        if (this.map.dragging) {
            this.map.dragging.enable();
        }
        document.body.classList.remove('eraser-mode');
    },

    /**
     * Remove any debug points layer from the map.

     */
    clearDebugPoints() {
        if (this.debugPointsLayer && this.map) {
            this.map.removeLayer(this.debugPointsLayer);
            this.debugPointsLayer = null;
        }
    },

    /**
     * Show all individual geometry points from the given lines array
     * as small markers on the map. Intended for debugging the density
     * and volume of stored route data.
     *
     * `lines` is expected to be the array returned from Storage.getLines().
     */
    showAllLinePoints(lines, {
        color = '#0070f3',
        radius = 2,
        opacity = 0.7,
        maxPoints = 50000
    } = {}) {
        if (!this.map || !Array.isArray(lines)) return;

        this.clearDebugPoints();

        const points = [];

        const pushCoords = (coords) => {
            if (!Array.isArray(coords)) return;
            coords.forEach((coord) => {
                if (!Array.isArray(coord) || coord.length < 2) return;
                const lon = coord[0];
                const lat = coord[1];
                if (typeof lat !== 'number' || typeof lon !== 'number') return;
                points.push([lat, lon]);
            });
        };

        lines.forEach((line) => {
            const geom = line && line.geometry;
            if (!geom || !Array.isArray(geom.coordinates)) return;

            if (geom.type === 'LineString') {
                pushCoords(geom.coordinates);
            } else if (geom.type === 'MultiLineString') {
                geom.coordinates.forEach((part) => pushCoords(part));
            }
        });

        if (points.length === 0) {
            return;
        }

        const limited = points.slice(0, maxPoints);

        this.debugPointsLayer = L.featureGroup(
            limited.map((latlng) =>
                L.circleMarker(latlng, {
                    radius,
                    color,
                    fillColor: color,
                    fillOpacity: opacity,
                    weight: 0
                })
            )
        ).addTo(this.map);

        try {
            this.map.fitBounds(this.debugPointsLayer.getBounds(), {
                paddingTopLeft: [450, 50],
                paddingBottomRight: [50, 50]
            });
        } catch (e) {
            // ignore fit errors in debug mode
        }
    },

    /**
     * Convenience helper: pull lines from Storage and visualize their
     * individual geometry points on the map. Safe to call from the
     * browser console for quick inspection:
     *
     *   MapManager.showAllLinePointsFromStorage();
     */
    showAllLinePointsFromStorage(options = {}) {
        let lines = [];
        try {
            // `Storage` is defined globally by js/storage.js
            if (typeof Storage !== 'undefined' && Storage && typeof Storage.getLines === 'function') {
                lines = Storage.getLines();
            }
        } catch (e) {
            lines = [];
        }

        this.showAllLinePoints(lines, options);
    }
};

// Simple global helpers for quick debugging from the browser console:
//   showTrainTrackerDebugPoints();
//   hideTrainTrackerDebugPoints();
window.showTrainTrackerDebugPoints = function (options) {
    if (typeof MapManager !== 'undefined' && MapManager && typeof MapManager.showAllLinePointsFromStorage === 'function') {
        MapManager.showAllLinePointsFromStorage(options);
    }
};

window.hideTrainTrackerDebugPoints = function () {
    if (typeof MapManager !== 'undefined' && MapManager && typeof MapManager.clearDebugPoints === 'function') {
        MapManager.clearDebugPoints();
    }
};
