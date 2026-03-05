const OJP_URL = 'https://api.opentransportdata.swiss/ojp20';
const OJP_TOKEN = 'eyJvcmciOiI2NDA2NTFhNTIyZmEwNTAwMDEyOWJiZTEiLCJpZCI6ImYxNDgyZGIxZDkxNjQ2NTFiNGIwMGMxYzdhNDQ5ZGFlIiwiaCI6Im11cm11cjEyOCJ9';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const API = {
    async fetchOJP(xmlPayload) {
        const response = await fetch(OJP_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/xml',
                'Authorization': `Bearer ${OJP_TOKEN}`
            },
            body: xmlPayload
        });
        if (!response.ok) {
            throw new Error(`OJP API error: ${response.status}`);
        }
        const text = await response.text();
        const parser = new DOMParser();
        return parser.parseFromString(text, "application/xml");
    },

    // 1. Station Autocomplete using OJP LocationInformationRequest
    async searchStation(query) {
        if (!query || query.length < 3) return [];

        const requestTimestamp = new Date().toISOString();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
    <OJPRequest>
        <siri:ServiceRequest>
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:RequestorRef>TrainTrackerWeb_test</siri:RequestorRef>
            <OJPLocationInformationRequest>
                <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
                <siri:MessageIdentifier>LIR-1</siri:MessageIdentifier>
                <InitialInput>
                    <Name>${query}</Name>
                </InitialInput>
                <Restrictions>
                    <Type>stop</Type>
                    <NumberOfResults>10</NumberOfResults>
                </Restrictions>
            </OJPLocationInformationRequest>
        </siri:ServiceRequest>
    </OJPRequest>
</OJP>`;

        try {
            const xmlDoc = await this.fetchOJP(xml);
            const results = [];
            const seenNames = new Set();

            const getElements = (parent, localName) => {
                let els = parent.getElementsByTagName(localName);
                if (els.length === 0) els = parent.getElementsByTagName('ojp:' + localName);
                if (els.length === 0) els = parent.getElementsByTagName('siri:' + localName);
                return els;
            };

            const placeResultsArr = getElements(xmlDoc, 'PlaceResult');

            for (let i = 0; i < placeResultsArr.length; i++) {
                const pr = placeResultsArr[i];

                let stopPlaceRef = '';
                let name = '';
                let lat = 0;
                let lon = 0;

                const stopPlaceRefEl = getElements(pr, 'StopPlaceRef')[0];
                if (stopPlaceRefEl) {
                    stopPlaceRef = stopPlaceRefEl.textContent;
                }

                const nameEl = getElements(pr, 'Name')[0];
                if (nameEl) {
                    const textEl = getElements(nameEl, 'Text')[0];
                    if (textEl) name = textEl.textContent.split('(')[0].trim();
                }

                if (!name) {
                    const stopPlaceNameEl = getElements(pr, 'StopPlaceName')[0];
                    if (stopPlaceNameEl) {
                        const textEl = getElements(stopPlaceNameEl, 'Text')[0];
                        if (textEl) name = textEl.textContent.split('(')[0].trim();
                    }
                }

                const geoEl = getElements(pr, 'GeoPosition')[0];
                if (geoEl) {
                    const latEl = getElements(geoEl, 'Latitude')[0];
                    const lonEl = getElements(geoEl, 'Longitude')[0];
                    if (latEl && lonEl) {
                        lat = parseFloat(latEl.textContent);
                        lon = parseFloat(lonEl.textContent);
                    }
                }

                if (name && stopPlaceRef && !seenNames.has(name)) {
                    seenNames.add(name);
                    results.push({
                        name: name,
                        fullName: name,
                        lat: lat,
                        lon: lon,
                        id: stopPlaceRef
                    });
                }
            }
            return results;
        } catch (error) {
            console.error("Error searching station:", error);
            return [];
        }
    },

    // 2. Find Routes between two stations using OJP TripRequest
    async findRouteBetweenStations(startStation, endStation) {
        if (!startStation.id || !endStation.id) {
            throw new Error("Start or end station is missing StopPlaceRef ID (id property).");
        }

        const requestTimestamp = new Date().toISOString();
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">
    <OJPRequest>
        <siri:ServiceRequest>
            <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
            <siri:RequestorRef>TrainTrackerWeb_test</siri:RequestorRef>
            <OJPTripRequest>
                <siri:RequestTimestamp>${requestTimestamp}</siri:RequestTimestamp>
                <siri:MessageIdentifier>TR-1</siri:MessageIdentifier>
                <Origin>
                    <PlaceRef>
                        <StopPlaceRef>${startStation.id}</StopPlaceRef>
                        <Name><Text>${startStation.name}</Text></Name>
                    </PlaceRef>
                    <DepArrTime>${requestTimestamp}</DepArrTime>
                </Origin>
                <Destination>
                    <PlaceRef>
                        <StopPlaceRef>${endStation.id}</StopPlaceRef>
                        <Name><Text>${endStation.name}</Text></Name>
                    </PlaceRef>
                </Destination>
                <Params>
                    <NumberOfResults>5</NumberOfResults>
                    <IncludeTrackSections>true</IncludeTrackSections>
                    <IncludeLegProjection>true</IncludeLegProjection>
                    <IncludeIntermediateStops>true</IncludeIntermediateStops>
                </Params>
            </OJPTripRequest>
        </siri:ServiceRequest>
    </OJPRequest>
</OJP>`;

        try {
            const xmlDoc = await this.fetchOJP(xml);
            return this.parseOJPTripToGeoJSON(xmlDoc);
        } catch (error) {
            console.error("Error fetching route:", error);
            throw error;
        }
    },

    parseOJPTripToGeoJSON(xmlDoc) {
        const routes = [];
        const seenPathKeys = new Set();

        const getElements = (parent, localName) => {
            let els = parent.getElementsByTagName(localName);
            if (els.length === 0) els = parent.getElementsByTagName('ojp:' + localName);
            if (els.length === 0) els = parent.getElementsByTagName('siri:' + localName);
            return els;
        };

        const tripResults = getElements(xmlDoc, 'TripResult');

        // Build a normalized geometry signature for a path. We sample along the
        // coordinates and round to ~1 km, which smooths out tiny variations
        // (e.g. different platforms or track alignment) but still
        // distinguishes genuinely different corridors.
        const buildShapeKey = (coords) => {
            if (!coords || coords.length === 0) return '';
            const points = [];
            const sampleCount = 20;
            const step = Math.max(1, Math.floor(coords.length / sampleCount));

            for (let i = 0; i < coords.length; i += step) {
                const [lon, lat] = coords[i];
                points.push(`${lon.toFixed(2)},${lat.toFixed(2)}`);
            }
            // Ensure we always include the last point
            const [lonLast, latLast] = coords[coords.length - 1];
            points.push(`${lonLast.toFixed(2)},${latLast.toFixed(2)}`);

            return points.join('|');
        };

        // Helper to extract a human-friendly service name (e.g. "IC 3", "IR 36").
        // We explicitly avoid low-level technical IDs like "ojp:91036:A".
        const getServiceName = (serviceEl) => {
            if (!serviceEl) return '';

            const nicePattern = /^(IC|IR|RE|EC|RJX?|S|R|SN|PE)\s*\d+/i;

            // 1) Prefer PublishedLineName->Text if it looks like a real line code
            const publishedEl = getElements(serviceEl, 'PublishedLineName')[0];
            if (publishedEl) {
                const textEl = getElements(publishedEl, 'Text')[0] || publishedEl;
                const raw = (textEl.textContent || '').trim();
                if (nicePattern.test(raw)) {
                    return raw;
                }
            }

            // 2) Fallback to Name->Text if it looks nice
            const nameEl = getElements(serviceEl, 'Name')[0];
            if (nameEl) {
                const textEl = getElements(nameEl, 'Text')[0] || nameEl;
                const raw = (textEl.textContent || '').trim();
                if (nicePattern.test(raw)) {
                    return raw;
                }
            }

            // 3) If nothing matches a friendly pattern, don't show a service code at all
            return '';
        };

        for (let i = 0; i < tripResults.length; i++) {
            const tr = tripResults[i];

            const tripLegs = getElements(tr, 'Leg');

            const tripCoordinates = [];
            let overallOrigin = '';
            let overallDestination = '';
            let operator = '';
            const serviceNames = new Set();
            let departureTime = '';
            const viaStops = new Set();
            let directionTo = '';

            for (let j = 0; j < tripLegs.length; j++) {
                const leg = tripLegs[j];

                const serviceEl = getElements(leg, 'Service')[0];
                if (serviceEl) {
                    const serviceName = getServiceName(serviceEl);
                    if (serviceName) serviceNames.add(serviceName);

                    const operatorEl = getElements(serviceEl, 'OperatorRef')[0];
                    if (operatorEl && !operator) {
                        operator = operatorEl.textContent.trim();
                    }

                    // Direction: where the physical train continues to
                    if (!directionTo) {
                        const destTextEl = getElements(serviceEl, 'DestinationText')[0];
                        if (destTextEl) {
                            const textEl = getElements(destTextEl, 'Text')[0] || destTextEl;
                            const raw = (textEl.textContent || '').trim();
                            if (raw) directionTo = raw;
                        }
                    }
                }

                // Determine overall origin and departure time from the first leg's board stop
                if (j === 0) {
                    const legBoardEl = getElements(leg, 'LegBoard')[0];
                    if (legBoardEl) {
                        let stopNameEl = getElements(legBoardEl, 'StopPointName')[0];
                        if (!stopNameEl) stopNameEl = getElements(legBoardEl, 'StopPlaceName')[0];

                        if (stopNameEl) {
                            const textEl = getElements(stopNameEl, 'Text')[0];
                            if (textEl) overallOrigin = textEl.textContent.trim();
                        }

                        // Try to extract a human-readable departure time (HH:MM) if available
                        const depTimeEl = getElements(legBoardEl, 'ServiceDepartureTime')[0]
                            || getElements(legBoardEl, 'TimetabledTime')[0];
                        if (depTimeEl && !departureTime) {
                            const rawTime = (depTimeEl.textContent || '').trim();
                            // Many OJP implementations use ISO 8601 timestamps
                            if (rawTime.length >= 16 && rawTime.includes('T')) {
                                departureTime = rawTime.substring(11, 16); // HH:MM
                            }
                        }
                    }
                }

                // Collect intermediate stop names for this leg (used to distinguish paths, e.g. via Olten vs via Rheinfelden)
                const legIntermediates = getElements(leg, 'LegIntermediate');
                for (let li = 0; li < legIntermediates.length; li++) {
                    const interm = legIntermediates[li];
                    let stopNameEl = getElements(interm, 'StopPointName')[0];
                    if (!stopNameEl) stopNameEl = getElements(interm, 'StopPlaceName')[0];
                    if (stopNameEl) {
                        const textEl = getElements(stopNameEl, 'Text')[0] || stopNameEl;
                        const name = (textEl.textContent || '').trim();
                        if (name && name !== overallOrigin && name !== overallDestination) {
                            viaStops.add(name);
                        }
                    }
                }

                // Determine overall destination from the last leg's alight stop
                if (j === tripLegs.length - 1) {
                    const legAlightEl = getElements(leg, 'LegAlight')[0];
                    if (legAlightEl) {
                        let stopNameEl = getElements(legAlightEl, 'StopPointName')[0];
                        if (!stopNameEl) stopNameEl = getElements(legAlightEl, 'StopPlaceName')[0];

                        if (stopNameEl) {
                            const textEl = getElements(stopNameEl, 'Text')[0];
                            if (textEl) overallDestination = textEl.textContent.trim();
                        }
                    }
                }

                // Collect geometry for this leg and append to the trip's overall geometry
                const legTracks = getElements(leg, 'LegTrack');
                for (let k = 0; k < legTracks.length; k++) {
                    const trackSects = getElements(legTracks[k], 'TrackSection');
                    for (let m = 0; m < trackSects.length; m++) {
                        const linkProjs = getElements(trackSects[m], 'LinkProjection');
                        for (let n = 0; n < linkProjs.length; n++) {
                            const posList = getElements(linkProjs[n], 'Position');
                            for (let p = 0; p < posList.length; p++) {
                                const pos = posList[p];
                                const latEl = getElements(pos, 'Latitude')[0];
                                const lonEl = getElements(pos, 'Longitude')[0];

                                if (latEl && lonEl) {
                                    tripCoordinates.push([parseFloat(lonEl.textContent), parseFloat(latEl.textContent)]);
                                }
                            }
                        }
                    }
                }
            }

            if (tripCoordinates.length > 1 && overallOrigin && overallDestination) {
                const viaArray = Array.from(viaStops);

                const shapeKey = buildShapeKey(tripCoordinates);

                const primaryVia = viaArray[0] || '';
                const pathKey = `${overallOrigin}|${overallDestination}|${shapeKey}`;
                if (seenPathKeys.has(pathKey)) {
                    continue;
                }
                seenPathKeys.add(pathKey);

                const baseName = `${overallOrigin} ➔ ${overallDestination}`;
                const serviceSummary = Array.from(serviceNames).join(' + ');
                const routeName = baseName;

                const id = `ojp-trip-${i}`;
                routes.push({
                    type: 'Feature',
                    id: id,
                    properties: {
                        id: id,
                        name: routeName,
                        network: operator || 'Train Network',
                        operator: operator,
                        from: overallOrigin,
                        to: overallDestination,
                        departureTime: departureTime,
                        via: primaryVia,
                        shapeKey: shapeKey,
                        directionTo: directionTo
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: tripCoordinates
                    }
                });
            }
        }
        return routes;
    },

    /**
     * Given a small number of user-selected points (typically start/end and
     * maybe one or two via points), fetch nearby railway infrastructure from
     * OpenStreetMap via the Overpass API and compute a path that follows
     * actual railway tracks between the clicked points.
     *
     * `points` is expected to be an array of objects with `{ lat, lng }`.
     * Returns an array of `[lon, lat]` coordinates suitable for a GeoJSON
     * LineString, or an empty array if no route can be found.
     */
    async buildRailRouteFromPoints(points) {
        if (!points || points.length < 2) {
            return [];
        }

        // Compute a bounding box around all clicked points. We use a
        // reasonably generous padding so that long-ish segments still
        // have continuous track coverage within the box.
        let minLat = Infinity, maxLat = -Infinity;
        let minLon = Infinity, maxLon = -Infinity;
        points.forEach((p) => {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lng < minLon) minLon = p.lng;
            if (p.lng > maxLon) maxLon = p.lng;
        });

        // Add padding so Overpass has enough context to connect tracks.
        // 0.2° is roughly 20–25 km in lat, which is usually enough for
        // a single "segment" the user wants to draw.
        const pad = 0.2;
        const south = minLat - pad;
        const north = maxLat + pad;
        const west = minLon - pad;
        const east = maxLon + pad;

        const overpassQuery = `
[out:json][timeout:25];
(
  way["railway"~"^(rail|light_rail|subway|tram)$"](${south},${west},${north},${east});
);
(._;>;);
out body;
`;

        let json;
        try {
            const url = `${OVERPASS_URL}?data=${encodeURIComponent(overpassQuery)}`;
            const response = await fetch(url, {
                method: 'GET'
            });

            if (!response.ok) {
                console.error('Overpass API error:', response.status, await response.text());
                return [];
            }

            json = await response.json();
        } catch (e) {
            console.error('Failed to fetch railway data from Overpass:', e);
            return [];
        }

        if (!json || !Array.isArray(json.elements)) {
            return [];
        }

        // Build node and graph structures
        const nodesById = {};
        const ways = [];

        json.elements.forEach((el) => {
            if (el.type === 'node') {
                nodesById[el.id] = {
                    id: el.id,
                    lat: el.lat,
                    lon: el.lon
                };
            } else if (el.type === 'way' && Array.isArray(el.nodes)) {
                ways.push(el);
            }
        });

        const nodeIds = Object.keys(nodesById);
        if (nodeIds.length === 0 || ways.length === 0) {
            console.warn('Overpass response had no railway nodes/ways in bbox', {
                nodeCount: nodeIds.length,
                wayCount: ways.length,
                bbox: { south, west, north, east }
            });
            return [];
        }

        // Adjacency list for the railway graph
        const adj = {};
        ways.forEach((way) => {
            const ids = way.nodes;
            for (let i = 0; i < ids.length - 1; i++) {
                const a = ids[i];
                const b = ids[i + 1];
                if (!adj[a]) adj[a] = new Set();
                if (!adj[b]) adj[b] = new Set();
                adj[a].add(b);
                adj[b].add(a);
            }
        });

        if (Object.keys(adj).length === 0) {
            return [];
        }

        const allNodeIds = Object.keys(nodesById);

        // Find the nearest graph node anywhere in the network
        const findNearestNodeId = (lat, lon) => {
            let bestId = null;
            let bestDist = Infinity;

            for (let i = 0; i < allNodeIds.length; i++) {
                const id = allNodeIds[i];
                const n = nodesById[id];
                const dLat = lat - n.lat;
                const dLon = lon - n.lon;
                const dist2 = dLat * dLat + dLon * dLon;
                if (dist2 < bestDist) {
                    bestDist = dist2;
                    bestId = id;
                }
            }

            return bestId;
        };

        // Find the nearest (way, node index) pair. This is used first to
        // handle the common/simple case where both clicks lie on the same
        // physical way: we can then just take the node slice between them
        // without running a full graph search.
        const findNearestOnWay = (lat, lon) => {
            let bestWay = null;
            let bestIndex = -1;
            let bestDist = Infinity;

            ways.forEach((way) => {
                const ids = way.nodes;
                for (let i = 0; i < ids.length; i++) {
                    const n = nodesById[ids[i]];
                    if (!n) continue;
                    const dLat = lat - n.lat;
                    const dLon = lon - n.lon;
                    const dist2 = dLat * dLat + dLon * dLon;
                    if (dist2 < bestDist) {
                        bestDist = dist2;
                        bestWay = way;
                        bestIndex = i;
                    }
                }
            });

            if (!bestWay || bestIndex < 0) return null;
            return { way: bestWay, index: bestIndex };
        };

        const bfsPath = (startId, endId) => {
            if (!startId || !endId || !adj[startId] || !adj[endId]) {
                return null;
            }

            const queue = [startId];
            const visited = new Set([startId]);
            const prev = {};

            while (queue.length > 0) {
                const current = queue.shift();
                if (current === endId) break;

                const neighbors = adj[current];
                if (!neighbors) continue;

                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        prev[neighbor] = current;
                        queue.push(neighbor);
                    }
                }
            }

            if (!visited.has(endId)) {
                return null;
            }

            const path = [];
            let cur = endId;
            while (cur !== undefined) {
                path.push(cur);
                cur = prev[cur];
            }
            path.reverse();
            return path;
        };

        const routeCoords = [];

        // For each consecutive pair of clicked points, find a path along tracks
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];

            // First try the simple case: both clicks snap onto the same way.
            const aSnap = findNearestOnWay(a.lat, a.lng);
            const bSnap = findNearestOnWay(b.lat, b.lng);

            if (aSnap && bSnap && aSnap.way === bSnap.way) {
                const ids = aSnap.way.nodes;
                let startIdx = aSnap.index;
                let endIdx = bSnap.index;

                if (startIdx > endIdx) {
                    const tmp = startIdx;
                    startIdx = endIdx;
                    endIdx = tmp;
                }

                for (let idx = startIdx; idx <= endIdx; idx++) {
                    const n = nodesById[ids[idx]];
                    if (!n) continue;
                    // Avoid duplicating when stitching segments
                    if (routeCoords.length > 0 && i > 0 && idx === startIdx) {
                        continue;
                    }
                    routeCoords.push([n.lon, n.lat]);
                }
                continue;
            }

            // Fallback: run a graph search between nearest nodes on the network.
            const startNodeId = findNearestNodeId(a.lat, a.lng);
            const endNodeId = findNearestNodeId(b.lat, b.lng);

            const pathIds = bfsPath(startNodeId, endNodeId);
            if (!pathIds || pathIds.length < 2) {
                console.warn('Could not find railway path between points', {
                    from: a,
                    to: b,
                    startNodeId,
                    endNodeId
                });
                return [];
            }

            pathIds.forEach((nodeId, idx) => {
                const n = nodesById[nodeId];
                if (!n) return;

                // Avoid duplicating the junction node when stitching segments
                if (routeCoords.length > 0 && i > 0 && idx === 0) {
                    return;
                }
                routeCoords.push([n.lon, n.lat]);
            });
        }

        return routeCoords;
    }
};
