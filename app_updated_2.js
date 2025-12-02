// ================================ 
// app_updated.js
// Montreal Bike Accident Hotspots
// ================================

// ---------------- init map ----------------
const map = L.map('map').setView([45.508888, -73.561668], 12);

// Simple roads + green base (Carto Light - no labels)
L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '© OpenStreetMap, CARTO'
}).addTo(map);

// panes
map.createPane("roadsPane");   map.getPane("roadsPane").style.zIndex = 300;
map.createPane("collisionsPane"); map.getPane("collisionsPane").style.zIndex = 400;
map.createPane("heatPane");    map.getPane("heatPane").style.zIndex = 450;
map.createPane("densePane");   map.getPane("densePane").style.zIndex = 460;

// ---------------- state ----------------
let accidentsGeo = null;    // full accidents GeoJSON
let lanesGeo = null;        // bike network GeoJSON
let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let lanesLayer = null;
let densestMarker = null;

// the variable used to color the points
let selectedVariable = "ACCIDENT_TYPE"; 

// Filter state: empty Set = "no filter" (all values allowed)
const filterState = {
  ACCIDENT_TYPE: new Set(),
  WEATHER_LABEL: new Set(),
  LIGHTING_LABEL: new Set(),
  ON_BIKELANE: new Set()
};

// UI elements
const computeBtn = document.getElementById('computeBtn');
const resultText = document.getElementById('resultText');

// ---------------- helpers ----------------

// Accident type is now precomputed in Python as ACCIDENT_TYPE
function getAccidentColor(accType) {
  if (accType === "Fatal/Hospitalization") return "red";
  if (accType === "Injury") return "yellow";
  return "green"; // No Injury
}

function bikeLaneLabelFromProps(p) {
  return (p.ON_BIKELANE === true) ? "On Bike Lane" : "Off Bike Lane";
}

// Color helpers for categorical labels
function getColorFromLabel(label, palette) {
  if (!label) return palette[0];
  let n = 0;
  const s = String(label);
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i);
  return palette[n % palette.length];
}

function getWeatherColor(label) {
  const palette = [
    "#00ff00","#66ff66","#ccff66","#ffff66",
    "#ffcc66","#ff9966","#ff6666","#cc66ff",
    "#9966ff","#6666ff"
  ];
  return getColorFromLabel(label, palette);
}

function getLightingColor(label) {
  const palette = ["#ffff66", "#ffcc66", "#ff9966", "#ff6666"];
  return getColorFromLabel(label, palette);
}

// Unique values for building filter options
function getUniqueValues(field) {
  const vals = new Set();
  accidentsGeo.features.forEach(f => {
    const v = f.properties[field];
    if (v && v !== "Non précisé") vals.add(v);
  });
  return Array.from(vals).sort();
}

// Check if a feature passes current filters
function passesFilters(p) {
  // Accident type
  if (filterState.ACCIDENT_TYPE.size > 0 &&
      !filterState.ACCIDENT_TYPE.has(p.ACCIDENT_TYPE)) {
    return false;
  }

  // Weather
  if (filterState.WEATHER_LABEL.size > 0 &&
      !filterState.WEATHER_LABEL.has(p.WEATHER_LABEL)) {
    return false;
  }

  // Lighting
  if (filterState.LIGHTING_LABEL.size > 0 &&
      !filterState.LIGHTING_LABEL.has(p.LIGHTING_LABEL)) {
    return false;
  }

  // Bike lane
  const laneLabel = bikeLaneLabelFromProps(p);
  if (filterState.ON_BIKELANE.size > 0 &&
      !filterState.ON_BIKELANE.has(laneLabel)) {
    return false;
  }

  return true;
}

// Get features after filters applied
function getFilteredFeatures() {
  if (!accidentsGeo) return [];
  return accidentsGeo.features.filter(f => passesFilters(f.properties));
}

// Densest point: pick the point with most neighbours within 200m
function computeDensestPoint(features) {
  if (!features.length) return null;
  let bestCoord = null;
  let maxCount = -1;

  const radiusKm = 0.2; // ~200m

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const [lon, lat] = f.geometry.coordinates;
    const p = turf.point([lon, lat]);

    let count = 0;
    for (let j = 0; j < features.length; j++) {
      const f2 = features[j];
      const [lon2, lat2] = f2.geometry.coordinates;
      const p2 = turf.point([lon2, lat2]);
      const dist = turf.distance(p, p2, { units: 'kilometers' });
      if (dist <= radiusKm) count++;
    }

    if (count > maxCount) {
      maxCount = count;
      bestCoord = [lon, lat];
    }
  }
  return bestCoord;
}

// ----------------- load files -----------------
async function loadFiles() {
  async function tryFetch(name) {
    try {
      const r = await fetch(name);
      if (!r.ok) return null;
      const j = await r.json();
      console.log("Loaded:", name);
      return j;
    } catch (e) {
      console.warn("Fetch failed:", name, e);
      return null;
    }
  }

  // If bikes_with_lane_flag.geojson exists, it will be used, else bikes.geojson.
  accidentsGeo = await tryFetch('bikes_with_lane_flag.geojson') || await tryFetch('bikes.geojson');
  lanesGeo     = await tryFetch('reseau_cyclable.json');

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

  // Add bike lanes
  lanesLayer = L.geoJSON(lanesGeo, {
    pane: "roadsPane",
    style: { color: "#003366", weight: 2, opacity: 0.9 }
  }).addTo(map);

  addBikeLaneLegend();
  buildVariableAndFilterMenu();
  renderPreview();

  computeBtn.disabled = false;
  resultText.innerText = "Files loaded. Adjust filters and click 'Compute'.";
}
loadFiles();

// ---------------- Variable + Filter Side Menu -----------------
function buildVariableAndFilterMenu() {
  if (!accidentsGeo) return;

  const accidentTypes = getUniqueValues("ACCIDENT_TYPE");
  const weatherVals   = getUniqueValues("WEATHER_LABEL");
  const lightingVals  = getUniqueValues("LIGHTING_LABEL");
  const laneVals      = ["On Bike Lane", "Off Bike Lane"];

  const div = L.DomUtil.create('div', 'filters p-2 bg-white rounded shadow-sm');

  div.innerHTML = `
    <h6><b>Colour by</b></h6>
    <label><input type="radio" name="variable" value="ON_BIKELANE"> Bike Lane</label><br>
    <label><input type="radio" name="variable" value="ACCIDENT_TYPE" checked> Accident Type</label><br>
    <label><input type="radio" name="variable" value="WEATHER_LABEL"> Weather</label><br>
    <label><input type="radio" name="variable" value="LIGHTING_LABEL"> Lighting</label><br>
    <hr style="margin:6px 0;">
    <div style="font-size:12px;"><b>Filters</b> (multi-select)</div>
    <details open>
      <summary style="cursor:pointer;">Accident type</summary>
      <div id="filter-accident-type"></div>
    </details>
    <details>
      <summary style="cursor:pointer;">Weather</summary>
      <div id="filter-weather"></div>
    </details>
    <details>
      <summary style="cursor:pointer;">Lighting</summary>
      <div id="filter-lighting"></div>
    </details>
    <details>
      <summary style="cursor:pointer;">Bike lane</summary>
      <div id="filter-bikelane"></div>
    </details>
  `;

  const ctrl = L.control({position: 'topright'});
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  // Radio buttons: choose variable for colouring
  div.querySelectorAll('input[name="variable"]').forEach(radio => {
    radio.addEventListener('change', e => {
      selectedVariable = e.target.value;
      renderPreview();
    });
  });

  // Helper to add checkbox filters
  function addCheckbox(containerId, fieldKey, labelText, valueForFilter) {
    const container = div.querySelector(containerId);
    const id = `${fieldKey}_${valueForFilter}`.replace(/\s+/g, '_');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <label for="${id}">
        <input type="checkbox" id="${id}">
        ${labelText}
      </label>
    `;
    const cb = wrapper.querySelector('input');
    cb.addEventListener('change', () => {
      if (cb.checked) {
        filterState[fieldKey].add(valueForFilter);
      } else {
        filterState[fieldKey].delete(valueForFilter);
      }
      renderPreview();
    });
    container.appendChild(wrapper);
  }

  // Populate filters
  accidentTypes.forEach(v => addCheckbox('#filter-accident-type', 'ACCIDENT_TYPE', v, v));
  weatherVals.forEach(v   => addCheckbox('#filter-weather', 'WEATHER_LABEL', v, v));
  lightingVals.forEach(v => addCheckbox('#filter-lighting', 'LIGHTING_LABEL', v, v));
  laneVals.forEach(v     => addCheckbox('#filter-bikelane', 'ON_BIKELANE', v, v));
}

// ---------------- render preview -----------------
function renderPreview() {
  if (!accidentsGeo) return;

  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if (densestMarker) { map.removeLayer(densestMarker); densestMarker = null; }

  const feats = getFilteredFeatures();

  feats.forEach(f => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties;

    // Determine color based on selected variable
    let color = "#666";
    if (selectedVariable === "ACCIDENT_TYPE") {
      color = getAccidentColor(p.ACCIDENT_TYPE);
    } else if (selectedVariable === "WEATHER_LABEL") {
      color = getWeatherColor(p.WEATHER_LABEL);
    } else if (selectedVariable === "LIGHTING_LABEL") {
      color = getLightingColor(p.LIGHTING_LABEL);
    } else if (selectedVariable === "ON_BIKELANE") {
      color = p.ON_BIKELANE === true ? "green" : "red";
    }

    const marker = L.circleMarker([lat, lon], {
      pane: "collisionsPane",
      radius: 4,
      fillColor: color,
      color: "#333",
      weight: 1,
      fillOpacity: 0.9
    }).bindPopup(`
      <b>ID:</b> ${p.NO_SEQ_COLL || ''}<br>
      <b>Accident type:</b> ${p.ACCIDENT_TYPE}<br>
      <b>Weather:</b> ${p.WEATHER_LABEL}<br>
      <b>Lighting:</b> ${p.LIGHTING_LABEL}<br>
      <b>Bike Lane:</b> ${bikeLaneLabelFromProps(p)}
    `);
    accidentsLayer.addLayer(marker);
  });

  // Heatmap for filtered accidents
  if (feats.length > 0) {
    const pts = feats.map(f => {
      const [lon, lat] = f.geometry.coordinates;
      return [lat, lon, 0.7];
    });
    const heat = L.heatLayer(pts, { 
      pane: "heatPane", 
      radius: 25, 
      blur: 20, 
      gradient:{0.2:'yellow',0.5:'orange',1:'red'}, 
      minOpacity: 0.3 
    });
    heatLayer.addLayer(heat);
  }

  // Densest marker based on filtered points
  const denseCoord = computeDensestPoint(feats);
  if (denseCoord) {
    densestMarker = L.circleMarker([denseCoord[1], denseCoord[0]], {
      pane: "densePane",
      radius: 8,
      color: "#000",
      weight: 2,
      fillColor: "#000",
      fillOpacity: 0.7
    }).bindPopup("Approximate densest area (within 200m neighbourhood)");
    densestMarker.addTo(map);
  }
}

// ---------------- Compute Results -----------------
computeBtn.addEventListener('click', () => {
  if (!accidentsGeo) {
    resultText.innerText = "Data not loaded.";
    return;
  }

  const feats = getFilteredFeatures();
  const total = feats.length;

  if (total === 0) {
    resultText.innerText = "No accidents match current filters.";
    return;
  }

  const categoryCounts = {};
  feats.forEach(f => {
    const p = f.properties;
    let val;

    switch(selectedVariable) {
      case 'ACCIDENT_TYPE':
        val = p.ACCIDENT_TYPE;
        break;
      case 'WEATHER_LABEL':
        val = p.WEATHER_LABEL;
        break;
      case 'LIGHTING_LABEL':
        val = p.LIGHTING_LABEL;
        break;
      case 'ON_BIKELANE':
        val = bikeLaneLabelFromProps(p);
        break;
      default:
        val = "Unknown";
    }

    categoryCounts[val] = (categoryCounts[val] || 0) + 1;
  });

  // Calculate percentages
  const entries = Object.entries(categoryCounts)
    .sort((a,b) => b[1] - a[1]); // sort by count desc

  let output = '';
  entries.forEach(([k, count]) => {
    const pct = ((count / total) * 100).toFixed(1);
    output += `${k}: ${pct}%<br>`;
  });
  resultText.innerHTML = output;
});

// ---------------- Legend for bike lanes -----------------
function addBikeLaneLegend() {
  const legend = L.control({position:'bottomleft'});
  legend.onAdd = function() {
    const div = L.DomUtil.create('div', 'results-bar');
    div.innerHTML = '<span style="background:#003366;width:20px;height:4px;display:inline-block;margin-right:5px;"></span> Bike lanes';
    return div;
  };
  legend.addTo(map);
}

// ---------------- debug helper -----------------
window._map_state = function() {
  return {
    accidentsLoaded: !!accidentsGeo,
    lanesLoaded: !!lanesGeo,
    accidentsCount: accidentsGeo ? accidentsGeo.features.length : 0,
    lanesCount: lanesGeo ? (lanesGeo.features ? lanesGeo.features.length : 1) : 0
  };
};
