// ================================
// app_updated.js
// Montreal Bike Accident Hotspots
// ================================

// ---------------- init map ----------------
const map = L.map('map').setView([45.508888, -73.561668], 12);

// Simple roads + green base
L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '© OpenStreetMap, CARTO'
}).addTo(map);

// panes
map.createPane("roadsPane"); map.getPane("roadsPane").style.zIndex = 300;
map.createPane("collisionsPane"); map.getPane("collisionsPane").style.zIndex = 400;
map.createPane("heatPane"); map.getPane("heatPane").style.zIndex = 450;
map.createPane("densePane"); map.getPane("densePane").style.zIndex = 460;

// ---------------- state ----------------
let accidentsGeo = null;
let lanesGeo = null;
let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let lanesLayer = null;
let densestMarker = null;
let selectedVariable = null;

const computeBtn = document.getElementById('computeBtn');
const resultText = document.getElementById('resultText');

// ---------------- helpers ----------------

// Weather (11–19)
function getWeatherLabel(val) {
  const map = {
    11: "Clear",
    12: "Partly cloudy",
    13: "Cloudy",
    14: "Rain",
    15: "Snow",
    16: "Freezing rain",
    17: "Fog",
    18: "High winds",
    19: "Other precip",
    99: "Other / Unspecified"
  };
  return map[val] || "Undefined";
}

// Accident type
function getAccidentType(val) {
  if (!val) return "No Injury";
  const g = String(val).toLowerCase();
  if (g.includes("mortel") || g.includes("grave")) return "Fatal/Hospitalization";
  if (g.includes("léger")) return "Injury";
  return "No Injury";
}

function getAccidentColor(val) {
  const type = getAccidentType(val);
  if (type === "Fatal/Hospitalization") return "red";
  if (type === "Injury") return "yellow";
  return "green";
}

// Lighting
function getLightingLabel(val) {
  const map = {
    1: "Daytime – bright",
    2: "Daytime – semi-obscure",
    3: "Night – lit",
    4: "Night – unlit"
  };
  return map[val] || "Undefined";
}

// ----------------- load files -----------------
async function loadFiles() {

  async function tryFetch(name) {
    try {
      const r = await fetch(name);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  accidentsGeo = await tryFetch('bikes_with_lane_flag.geojson') ||
                 await tryFetch('bikes.geojson');

  // FIX: only load the real lane file
  lanesGeo = await tryFetch('reseau_cyclable.json');

  if (!accidentsGeo) {
    resultText.innerText = "Error: cannot load accidents file.";
    computeBtn.disabled = true;
    return;
  }
  if (!lanesGeo) {
    resultText.innerText = "Error: cannot load bike lanes file.";
    computeBtn.disabled = true;
    return;
  }

  lanesLayer = L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2 }
  }).addTo(map);

  addBikeLaneLegend();
  buildVariableMenu();
  renderPreview();

  computeBtn.disabled = false;
  resultText.innerText = "Files loaded.";
}
loadFiles();

// ---------------- Variable Menu -----------------
function buildVariableMenu() {
  if (!accidentsGeo) return;

  const div = L.domUtil.create('div', 'filters p-2 bg-white rounded shadow-sm');

  div.innerHTML = `
    <h6><b>Select Variable</b></h6>
    <label><input type="radio" name="variable" value="ON_BIKELANE"> Bike Lane</label><br>
    <label><input type="radio" name="variable" value="GRAVITE"> Accident Type</label><br>
    <label><input type="radio" name="variable" value="CD_COND_METEO"> Weather</label><br>
    <label><input type="radio" name="variable" value="CD_ECLRM"> Lighting</label><br>
  `;

  const ctrl = L.control({position: 'topright'});
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  div.querySelectorAll('input[name="variable"]').forEach(r => {
    r.addEventListener('change', e => {
      selectedVariable = e.target.value;
      renderPreview();
    });
  });
}

// ---------------- Render -----------------
function renderPreview() {
  if (!accidentsGeo) return;

  accidentsLayer.clearLayers();
  heatLayer.clearLayers();

  const feats = accidentsGeo.features;

  feats.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;

    let color = "#666";

    if (selectedVariable === "GRAVITE") color = getAccidentColor(p.GRAVITE);
    else if (selectedVariable === "CD_COND_METEO") color = getWeatherColor(p.CD_COND_METEO);
    else if (selectedVariable === "CD_ECLRM") color = getLightingColor(p.CD_ECLRM);
    else if (selectedVariable === "ON_BIKELANE") {
      color = p.ON_BIKELANE ? "green" : "red";
    }

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(`
      <b>ID:</b> ${p.NO_SEQ_COLL}<br>
      <b>Accident type:</b> ${getAccidentType(p.GRAVITE)}<br>
      <b>Weather:</b> ${getWeatherLabel(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${getLightingLabel(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${p.ON_BIKELANE ? 'Yes' : 'No'}
    `);

    accidentsLayer.addLayer(marker);
  });

  // Heatmap
  const pts = feats.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0], 0.7]);
  heatLayer.addLayer(L.heatLayer(pts, {radius: 25, blur: 20}));
}

// ---------------- Compute -----------------
computeBtn.addEventListener('click', () => {
  if (!accidentsGeo || !selectedVariable) return;

  const feats = accidentsGeo.features;
  const total = feats.length;

  const counts = {};

  feats.forEach(f => {
    const p = f.properties;
    let val;

    if (selectedVariable === 'GRAVITE') val = getAccidentType(p.GRAVITE);
    else if (selectedVariable === 'CD_COND_METEO') val = getWeatherLabel(p.CD_COND_METEO);
    else if (selectedVariable === 'CD_ECLRM') val = getLightingLabel(p.CD_ECLRM);
    else if (selectedVariable === 'ON_BIKELANE') val = p.ON_BIKELANE ? 'On Bike Lane' : 'Off Bike Lane';

    counts[val] = (counts[val] || 0) + 1;
  });

  let txt = "";
  for (const k in counts) {
    txt += `${k}: ${(counts[k]/total*100).toFixed(1)}%<br>`;
  }
  resultText.innerHTML = txt;
});

// ---------------- color helpers -----------------
function getWeatherColor(val) {
  return ['#00ff00','#66ff66','#ccff66','#ffff66','#ffcc66','#ff9966','#ff6666','#cc66ff','#9966ff'][val % 9] || '#888';
}

function getLightingColor(val) {
  return ['#ffff66','#ffcc66','#ff9966','#ff6666'][val - 1] || '#888';
}

// ---------------- Legend -----------------
function addBikeLaneLegend() {
  const legend = L.control({position:'bottomleft'});
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'results-bar');
    div.innerHTML = '<span style="background:#003366;width:20px;height:4px;display:inline-block;margin-right:5px;"></span> Bike lanes';
    return div;
  };
  legend.addTo(map);
}
