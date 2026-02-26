import urllib.request, json
query = """[out:json][timeout:50];
node(around:2000, 47.5476, 7.5896)["railway"~"station|stop|halt"]->.startNodes;
node(around:2000, 47.3781, 8.5401)["railway"~"station|stop|halt"]->.endNodes;
relation(bn.startNodes)["type"="route"]["route"="train"]->.startRoutes;
relation(bn.endNodes)["type"="route"]["route"="train"]->.endRoutes;
relation.startRoutes.endRoutes;
out body;
>;
out skel qt;
"""
req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=query.encode('utf-8'))
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        routes = [e for e in data['elements'] if e['type'] == 'relation']
        print("Found routes:", [r.get('tags', {}).get('name') or r.get('tags', {}).get('ref') for r in routes])
except Exception as e:
    print(e)
