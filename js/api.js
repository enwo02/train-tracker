const OJP_URL = 'https://api.opentransportdata.swiss/ojp20';
const OJP_TOKEN = 'eyJvcmciOiI2NDA2NTFhNTIyZmEwNTAwMDEyOWJiZTEiLCJpZCI6ImYxNDgyZGIxZDkxNjQ2NTFiNGIwMGMxYzdhNDQ5ZGFlIiwiaCI6Im11cm11cjEyOCJ9';

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
    }
};
