# Train Tracker

A browser-based interactive map application for visualising and saving your railway journeys. Search for train routes between stations across Europe and build a personal map of the lines you have travelled.

## Features

- **Station search** – autocomplete powered by the [Nominatim](https://nominatim.openstreetmap.org/) API (OpenStreetMap)
- **Route discovery** – finds train routes between two stations using the [Overpass API](https://overpass-api.de/)
- **Interactive map** – built with [Leaflet.js](https://leafletjs.com/) on a clean CartoDB Positron base layer with a subtle [OpenRailwayMap](https://www.openrailwaymap.org/) overlay
- **Route preview** – hover over a search result to preview the trimmed route geometry on the map
- **Persistent storage** – saved routes are stored in `localStorage` so they survive page reloads
- **SBB-inspired design** – clean, minimal UI using the Swiss Federal Railways red colour scheme
- **Responsive** – adapts to mobile screen sizes

## Tech stack

| Layer | Technology |
|---|---|
| UI | HTML5, CSS3, Vanilla JavaScript |
| Maps | [Leaflet.js 1.9.4](https://leafletjs.com/) |
| Base tiles | [CartoDB Positron](https://carto.com/basemaps/) |
| Railway tiles | [OpenRailwayMap](https://www.openrailwaymap.org/) |
| Station search | [Nominatim REST API](https://nominatim.org/release-docs/latest/api/Search/) |
| Route data | [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) |
| Persistence | Browser `localStorage` |

No build step, no dependencies to install – the app runs entirely in the browser.

## Getting started

Because the app fetches data from external APIs it must be served over HTTP (not opened as a `file://` URL).

### Option 1 – Python built-in server

```bash
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

### Option 2 – Node.js `http-server`

```bash
npx http-server -p 8080
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

### Option 3 – VS Code Live Server extension

Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension and click **Go Live** in the status bar.

## Usage

1. Type a **start station** name in the first input field (e.g. *Zürich HB*) and select a result from the autocomplete list.
2. Type an **end station** name in the second input field (e.g. *Bern*) and select a result.
3. Click **Search Route** – the app queries the Overpass API for train route relations passing through both stations.
4. Hover over a result to preview the route on the map; click **Add** to save it.
5. Saved routes appear in the **Your Saved Routes** panel and are drawn on the map as solid red lines. Click a saved route to zoom the map to it, or use the trash icon to remove it.

## Project structure

```
train-tracker/
├── index.html          # Application shell
├── style.css           # All styles (SBB theme, responsive layout)
└── js/
    ├── api.js          # Nominatim station search + Overpass route query & parsing
    ├── app.js          # Application logic, UI bindings, state management
    ├── map.js          # Leaflet map initialisation and layer management
    └── storage.js      # localStorage read/write helpers
```

## API notes

- **Nominatim** – searches for railway stations by name. Requires at least 3 characters before querying. Results are debounced (500 ms) to respect API usage policy.
- **Overpass API** – queries `type=route / route=train` relations inside a bounding box that covers both stations (with a 0.05° padding). Routes are filtered to those passing within 2 000 m of both stations and their geometry is trimmed to the segment between the two stations.

## License

This project is open source. See the repository for details.
