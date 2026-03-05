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
                    <IncludeIntermediateStops>false</IncludeIntermediateStops>
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
        const seenNames = new Set();

        const getElements = (parent, localName) => {
            let els = parent.getElementsByTagName(localName);
            if (els.length === 0) els = parent.getElementsByTagName('ojp:' + localName);
            if (els.length === 0) els = parent.getElementsByTagName('siri:' + localName);
            return els;
        };

        const tripResults = getElements(xmlDoc, 'TripResult');

        for (let i = 0; i < tripResults.length; i++) {
            const tr = tripResults[i];

            const tripLegs = getElements(tr, 'Leg');

            for (let j = 0; j < tripLegs.length; j++) {
                const leg = tripLegs[j];

                const serviceEl = getElements(leg, 'Service')[0];
                if (!serviceEl) continue;

                let lineName = 'Unknown Line';
                const publishedLineNameEl = getElements(serviceEl, 'PublishedLineName')[0];
                if (publishedLineNameEl) {
                    const textEl = getElements(publishedLineNameEl, 'Text')[0];
                    if (textEl) lineName = textEl.textContent.trim();
                }

                let destination = '';
                const destEl = getElements(serviceEl, 'DestinationText')[0];
                if (destEl) {
                    const textEl = getElements(destEl, 'Text')[0];
                    if (textEl) destination = textEl.textContent.trim();
                }

                let operator = '';
                const operatorEl = getElements(serviceEl, 'OperatorRef')[0];
                if (operatorEl) operator = operatorEl.textContent.trim();

                let origin = '';
                const legBoardEl = getElements(leg, 'LegBoard')[0];
                if (legBoardEl) {
                    let stopNameEl = getElements(legBoardEl, 'StopPointName')[0];
                    if (!stopNameEl) stopNameEl = getElements(legBoardEl, 'StopPlaceName')[0];

                    if (stopNameEl) {
                        const textEl = getElements(stopNameEl, 'Text')[0];
                        if (textEl) origin = textEl.textContent.trim();
                    }
                }

                const legTracks = getElements(leg, 'LegTrack');
                const coordinates = [];
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
                                    coordinates.push([parseFloat(lonEl.textContent), parseFloat(latEl.textContent)]);
                                }
                            }
                        }
                    }
                }

                if (coordinates.length > 1) {
                    const routeName = `${lineName} (${origin} ➔ ${destination})`;

                    if (!seenNames.has(routeName)) {
                        seenNames.add(routeName);
                        routes.push({
                            type: 'Feature',
                            id: `ojp-leg-${i}-${j}`,
                            properties: {
                                id: `ojp-leg-${i}-${j}`,
                                name: routeName,
                                network: operator || 'Train Network',
                                operator: operator,
                                from: origin,
                                to: destination
                            },
                            geometry: {
                                type: 'LineString',
                                coordinates: coordinates
                            }
                        });
                    }
                }
            }
        }

        return routes;
    }
};
