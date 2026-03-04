const MapManager = {
    map: null,
    tempLayer: null,
    savedLayers: null,

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

        // Removed OpenRailwayMap overlay to leave a clean CartoDB Positron base.

        // Reposition zoom control
        L.control.zoom({
            position: 'topright'
        }).addTo(this.map);

        // Layer group for saved lines
        this.savedLayers = L.featureGroup().addTo(this.map);
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
                paddingTopLeft: [50, 50],
                paddingBottomRight: [450, 50]
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
    }
};
