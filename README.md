# Train Tracker

A browser-based interactive map application for visualising and saving your railway journeys. Search for real Swiss train connections using the Open Journey Planner (OJP) API and build a personal map of the lines you have travelled.

## Features

- **Station search** – autocomplete powered by the OJP `OJPLocationInformationRequest` endpoint of [opentransportdata.swiss](https://opentransportdata.swiss/)
- **Route discovery** – finds trips between two stations using the OJP `OJPTripRequest` endpoint and turns each distinct path into a selectable option
- **Path-aware options** – options are grouped by their actual route:
  - title always shows **From ➔ To**
  - optional **Dir** line shows the train’s final destination (e.g. *Zürich HB ➔ Chur*)
  - optional **Via** line highlights the main corridor (e.g. *Via: Zürich Hardbrücke* vs *Via: Zürich Wipkingen*)
- **Interactive map** – built with [Leaflet.js](https://leafletjs.com/) on a clean CartoDB Positron base layer with a subtle [OpenRailwayMap](https://www.openrailwaymap.org/) overlay
- **Route preview** – hover over a search result to preview the full journey geometry on the map
- **Persistent storage** – saved routes are stored in `localStorage` so they survive page reloads
- **Optional Google Drive sync** – connect Drive to automatically sync saved routes across browsers/devices (works on GitHub Pages)
- **SBB-inspired design** – clean, minimal UI using the Swiss Federal Railways red colour scheme
- **Responsive** – adapts to mobile screen sizes

## Tech stack

| Layer | Technology |
|---|---|
| UI | HTML5, CSS3, Vanilla JavaScript |
| Maps | [Leaflet.js 1.9.4](https://leafletjs.com/) |
| Base tiles | [CartoDB Positron](https://carto.com/basemaps/) |
| Railway tiles | [OpenRailwayMap](https://www.openrailwaymap.org/) |
| Station & trip search | [Open Journey Planner (OJP) – opentransportdata.swiss](https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp/) |
| Persistence | Browser `localStorage` |

No build step, no dependencies to install – the app runs entirely in the browser.

## Optional: Google Drive sync (cross-device)

This project can optionally sync your saved routes to **your own Google Drive** (in the hidden `appDataFolder`) so the same routes appear on all your devices.

- **No backend required**: works on GitHub Pages.
- **No app storage cost**: uses the user's existing Google Drive storage.
- **Privacy**: the file is stored in `appDataFolder` (not shown in normal Drive UI).

### Setup

1. Create an OAuth client id (Web) in Google Cloud Console and enable the Google Drive API.
2. Add your origins to the OAuth client:
   - `http://localhost:8080` (or whatever port you use)
   - your GitHub Pages origin (e.g. `https://<user>.github.io`)
3. Put your OAuth client id in `js/drive-sync.js` (constant `DEFAULT_CLIENT_ID`), or set it via:
   - `window.TRAIN_TRACKER_GOOGLE_CLIENT_ID = '...';` (e.g. in `js/config.local.js`)

### Usage

Click **Connect Drive** in the sidebar, accept the Google consent prompt, then click **Sync** as needed.

## Getting started

Because the app fetches data from external APIs it must be served over HTTP (not opened as a `file://` URL).

### 1. Obtain an OJP API token

Create an account on [opentransportdata.swiss](https://opentransportdata.swiss/) and request access to the **Open Journey Planner** API.  
Once you have a token, configure it in `js/api.js` (`OJP_TOKEN` constant).

### 2. Start a simple web server

Any static HTTP server will do. For example:

#### Option 1 – Python built-in server

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

#### Option 2 – Node.js `http-server`

```bash
npx http-server -p 8080
```

Then open `http://localhost:8080` in your browser.

#### Option 3 – VS Code Live Server extension

Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension and click **Go Live** in the status bar.

### 3. (Optional) Build local railway tiles from OSM extracts

The manual “draw route on map” feature snaps your clicks to real railway track geometry.  
For this it uses static **1° × 1° GeoJSON tiles** in `data/tiles/`, which you can build from
your own `.osm.pbf` extracts.

Requirements:

- `osmium` CLI (osmium-tool) installed and on your `PATH`  
  - On macOS: `brew install osmium-tool`
- Node.js (used to run the helper script)

Steps:

1. **Download OSM PBF extracts** (for the regions you care about) from a provider such as [Geofabrik](https://download.geofabrik.de/).
2. **Copy the `.osm.pbf` files into the `data/` folder** of this project, for example:

   - `data/switzerland.osm.pbf`
   - `data/austria.osm.pbf`

3. **Run the tile build script** from the project root:

   ```bash
   node scripts/build-rail-tiles.js
   ```

   The script will, for each `*.osm.pbf` in `data/`:

   - filter only `railway=rail|light_rail|subway|tram` ways using `osmium tags-filter`
   - export them as GeoJSON linestrings (stored in `data/_tmp_rail_build/`)
   - stream the GeoJSON and aggregate into 1° × 1° tiles under `data/tiles/<lat>_<lon>.geojson`

   During tiling it prints progress (feature count, MB read, and percentage). Tiles are written incrementally as `*.geojson.partial` and renamed to `*.geojson` when finished, so you can see output appearing while it runs. Large extracts (e.g. Europe) can take a long time; re-runs skip steps that are already up to date (intermediate files in `data/_tmp_rail_build/` are kept by default).

   **Options:**

   - `--fresh` — Clear `data/_tmp_rail_build/` and rebuild all steps from the PBFs.
   - `--clean` — Remove `data/_tmp_rail_build/` when finished (default: keep it for incremental runs).

4. Commit `data/tiles/*.geojson` if you want them to be available when deploying
   (e.g. GitHub Pages). The app will automatically load whatever tiles exist for
   the current map view and use them for snapping manual routes to the tracks.

## Usage

1. Type a **start station** name in the first input field (e.g. *Zürich HB*) and select a result from the autocomplete list.
2. Type an **end station** name in the second input field (e.g. *Bern*) and select a result.
3. Click **Search Route** – the app sends an `OJPTripRequest` to opentransportdata.swiss and parses the returned trips.
4. For each distinct physical path between the two stations, one option is shown with:
   - **title**: `From ➔ To`
   - **Dir** (optional): where the train continues to after your destination
   - **Via** (optional): a key intermediate station that distinguishes the corridor
5. Hover over a result to preview the route on the map; click **Add** to save it.
6. Saved routes appear in the **Your Saved Routes** panel using the same `From ➔ To / Dir / Via` formatting and are drawn on the map as solid red lines. Click a saved route to zoom the map to it, or use the trash icon to remove it.

## Project structure

```
train-tracker/
├── index.html          # Application shell
├── style.css           # All styles (SBB theme, responsive layout)
└── js/
    ├── api.js          # OJP station & trip requests + XML parsing to GeoJSON
    ├── app.js          # Application logic, UI bindings, option deduping & formatting
    ├── map.js          # Leaflet map initialisation and layer management
    └── storage.js      # localStorage read/write helpers
```

## API notes

- **OJP LocationInformationRequest** – used for station autocomplete. Requires at least 3 characters before querying. Results are debounced (500 ms) to respect API usage policy.
- **OJP TripRequest** – returns trip options between the selected stations including legs, intermediate stops and track geometry. The app:
  - aggregates per-trip leg geometry into a single `LineString`
  - extracts origin, destination, an optional main via stop and the train’s final destination
  - groups trips that share the same corridor so only distinct paths appear in the UI

## License

This project is open source. See the repository for details.
