const API = {
    // 1. Station Autocomplete using Nominatim
    async searchStation(query) {
        if (!query || query.length < 3) return [];

        // Focus search on railway stations and explicitly enforce English as the primary language
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&class=railway&type=station&limit=5&accept-language=en,local`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Accept-Language': 'en' // Reinforce English
                }
            });
            if (!response.ok) throw new Error("Nominatim API error");
            const data = await response.json();

            const results = [];
            const seenNames = new Set();

            for (const item of data) {
                const name = item.display_name.split(',')[0].trim();
                // Prevent duplicate entries like multiple "Basel SBB" nodes
                if (!seenNames.has(name)) {
                    seenNames.add(name);
                    results.push({
                        name: name,
                        fullName: item.display_name,
                        lat: parseFloat(item.lat),
                        lon: parseFloat(item.lon)
                    });
                }
            }

            return results;
        } catch (error) {
            console.error("Error searching station:", error);
            return [];
        }
    },

    // 2. Find Routes between two stations using Overpass
    async findRouteBetweenStations(startStation, endStation) {
        // Build a bounding box that encompasses both stations
        const minLat = Math.min(startStation.lat, endStation.lat);
        const maxLat = Math.max(startStation.lat, endStation.lat);
        const minLon = Math.min(startStation.lon, endStation.lon);
        const maxLon = Math.max(startStation.lon, endStation.lon);

        // A smaller padding (approx 5km) to keep the query fast
        const pad = 0.05;
        const bbox = `${minLat - pad},${minLon - pad},${maxLat + pad},${maxLon + pad}`;

        const query = `
            [out:json][timeout:50];
            relation["type"="route"]["route"="train"](${bbox});
            out body;
            >;
            out skel qt;
        `;

        const maxRetries = 3;
        let attempt = 0;

        while (attempt <= maxRetries) {
            try {
                const response = await fetch('https://overpass-api.de/api/interpreter', {
                    method: 'POST',
                    body: query
                });

                if (!response.ok) {
                    if ((response.status === 429 || response.status === 504 || response.status === 503) && attempt < maxRetries) {
                        attempt++;
                        const delay = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
                        console.warn(`Overpass API busy (status ${response.status}). Retrying in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                    throw new Error(`Overpass API error: ${response.status}`);
                }

                const data = await response.json();
                return this.parseOverpassRelationsToGeoJSON(data, startStation, endStation);
            } catch (error) {
                if (attempt < maxRetries) {
                    attempt++;
                    const delay = 2000 * Math.pow(2, attempt - 1);
                    console.warn(`Overpass API fetch error: ${error.message}. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                console.error("Error fetching route:", error);
                throw error;
            }
        }
    },

    // Haversine distance in meters
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // metres
        const lat1Rad = lat1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        const deltaLat = (lat2 - lat1) * Math.PI / 180;
        const deltaLon = (lon2 - lon1) * Math.PI / 180;

        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    },

    parseOverpassRelationsToGeoJSON(data, startStation, endStation) {
        const nodes = {};
        const ways = {};
        const routes = [];

        // 1. Map nodes
        data.elements.forEach(el => {
            if (el.type === 'node') {
                nodes[el.id] = [el.lon, el.lat];
            }
        });

        // 2. Map ways (arrays of coordinates)
        data.elements.forEach(el => {
            if (el.type === 'way' && el.nodes) {
                const coords = el.nodes.map(nid => nodes[nid]).filter(Boolean);
                if (coords.length > 1) {
                    ways[el.id] = coords;
                }
            }
        });

        // 3. Reconstruct Relations and Filter
        data.elements.forEach(el => {
            if (el.type === 'relation' && el.members) {
                let ref = el.tags.ref || "";
                let rawName = el.tags.name || "";
                let name = "Unknown Route";

                if (ref && rawName) {
                    const cleanRef = ref.replace(/\s+/g, '').toLowerCase();
                    const cleanNamePrefix = rawName.replace(/\s+/g, '').toLowerCase();

                    // Prevent duplication like "IR36 - IR36"
                    if (cleanNamePrefix.startsWith(cleanRef)) {
                        name = rawName;
                    } else {
                        name = `${ref} - ${rawName}`;
                    }
                } else {
                    name = rawName || ref || "Unknown Route";
                }

                // Normalize varying arrow styles to a single standard arrow ➔
                name = name.replace(/\s*(=>|->|⇒|→)\s*/g, ' ➔ ');

                const multiLineCoords = [];
                let minStartDist = Infinity;
                let minEndDist = Infinity;

                el.members.forEach(member => {
                    if (member.type === 'way' && ways[member.ref]) {
                        const coordsList = ways[member.ref];
                        multiLineCoords.push(coordsList);

                        // Check distance to start/end stations for each node in the way
                        coordsList.forEach(coord => {
                            const lon = coord[0];
                            const lat = coord[1];

                            const distToStart = this.calculateDistance(lat, lon, startStation.lat, startStation.lon);
                            const distToEnd = this.calculateDistance(lat, lon, endStation.lat, endStation.lon);

                            if (distToStart < minStartDist) minStartDist = distToStart;
                            if (distToEnd < minEndDist) minEndDist = distToEnd;
                        });
                    }
                });

                // A valid route must pass within 2000 meters of both the start and end stations
                if (multiLineCoords.length > 0 && minStartDist < 2000 && minEndDist < 2000) {

                    // --- Geometry Trimming Logic ---
                    // The route likely extends past the start/end stations (e.g., to Paris).
                    // We want to clip the line so it only draws the segment between start and end.

                    // First, flatten the multiLineCoords to find the closest points
                    // This relies on the way elements being generally ordered sequentially, 
                    // which is mostly true for route relations, but we handle unordered ways by 
                    // finding the overall closest way/index pairs for start and end.

                    let bestStart = { wayIdx: -1, ptIdx: -1, dist: Infinity };
                    let bestEnd = { wayIdx: -1, ptIdx: -1, dist: Infinity };

                    multiLineCoords.forEach((way, wayIdx) => {
                        way.forEach((coord, ptIdx) => {
                            const lon = coord[0];
                            const lat = coord[1];
                            const dStart = this.calculateDistance(lat, lon, startStation.lat, startStation.lon);
                            const dEnd = this.calculateDistance(lat, lon, endStation.lat, endStation.lon);

                            if (dStart < bestStart.dist) {
                                bestStart = { wayIdx, ptIdx, dist: dStart };
                            }
                            if (dEnd < bestEnd.dist) {
                                bestEnd = { wayIdx, ptIdx, dist: dEnd };
                            }
                        });
                    });

                    // If we found valid start/end anchors on the line
                    let clippedWays = [];
                    if (bestStart.wayIdx !== -1 && bestEnd.wayIdx !== -1) {
                        // Ensure start is before end. For circular or complex routes this might be tricky,
                        // but generally relation ways are ordered sequentially.
                        let first = bestStart;
                        let second = bestEnd;

                        if (bestStart.wayIdx > bestEnd.wayIdx ||
                            (bestStart.wayIdx === bestEnd.wayIdx && bestStart.ptIdx > bestEnd.ptIdx)) {
                            // Reverse order
                            first = bestEnd;
                            second = bestStart;
                        }

                        // Extract the slice
                        for (let i = first.wayIdx; i <= second.wayIdx; i++) {
                            let way = multiLineCoords[i];
                            let startPt = (i === first.wayIdx) ? first.ptIdx : 0;
                            let endPt = (i === second.wayIdx) ? second.ptIdx : way.length - 1;

                            // Include the segment
                            clippedWays.push(way.slice(startPt, endPt + 1));
                        }
                    } else {
                        // Fallback: if trimming logic fails, just use the whole line
                        clippedWays = multiLineCoords;
                    }

                    routes.push({
                        type: 'Feature',
                        id: el.id,
                        properties: {
                            id: el.id,
                            name: name,
                            network: el.tags.network || 'Unknown Network',
                            operator: el.tags.operator || '',
                            from: el.tags.from || '',
                            to: el.tags.to || ''
                        },
                        geometry: {
                            type: 'MultiLineString',
                            coordinates: clippedWays
                        }
                    });
                }
            }
        });

        // Filter out junk and deduplicate loosely
        const uniqueRoutes = [];
        const seenNames = new Set();

        for (const r of routes) {
            if (!seenNames.has(r.properties.name)) {
                seenNames.add(r.properties.name);
                uniqueRoutes.push(r);
            }
        }

        return uniqueRoutes;
    }
};
