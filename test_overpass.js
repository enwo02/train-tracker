const start = {lat: 47.5476, lon: 7.5896}; // Basel SBB
const end = {lat: 47.3781, lon: 8.5401}; // Zurich HB

const query = `
[out:json][timeout:50];

// Get railway stations around start and end
node(around:2000, ${start.lat}, ${start.lon})["railway"~"station|stop|halt"]->.startNodes;
node(around:2000, ${end.lat}, ${end.lon})["railway"~"station|stop|halt"]->.endNodes;

// Find relations containing those nodes
relation(bn.startNodes)["type"="route"]["route"="train"]->.startRoutes;
relation(bn.endNodes)["type"="route"]["route"="train"]->.endRoutes;

// Output intersection
relation.startRoutes.endRoutes;
out body;
>;
out skel qt;
`;

fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query
})
.then(res => res.json())
.then(data => {
    const routes = data.elements.filter(e => e.type === 'relation');
    console.log("Found routes:", routes.map(r => r.tags.name || r.tags.ref));
})
.catch(console.error);
