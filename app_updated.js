// ================================
// Montreal Bike Accident Hotspots
// ================================

// -------- MAP INIT --------
const map = L.map('map').setView([45.508888, -73.561668], 12);

L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '© OpenStreetMap, CARTO'
}).addTo(map);

// Panes
map.createPane("roadsPane");     map.getPane("roadsPane").style.zIndex = 300;
map.createPane("collisionsPane");map.getPane("collisionsPane").style.zIndex = 400;
map.createPane("heatPane");      map.getPane("heatPane").style.zIndex = 450;

// State
let accidentsGeo = null;
let lanesGeo = null;
let accidentsLayer = L.layerGroup().addTo(map);
let heatLayer = L.layerGroup().addTo(map);
let selectedVariable = null;

// UI
const computeBtn = document.getElementById("computeBtn");
const resultText = document.getElementById("resultText");

// ---------- WEATHER/LIGHTING DECODERS ----------
const WEATHER_MAP = {
  "11":"Clear","12":"Cloudy","13":"Fog","14":"Rain","15":"Snow",
  "16":"High Winds","17":"Freezing Rain","18":"Snowstorm","19":"Ice","99":"Other"
};
const LIGHTING_MAP = {
  "1":"Daylight",
  "2":"Semi-obscure",
  "3":"Night (lit)",
  "4":"Night (unlit)"
};

function decodeWeather(code){ return WEATHER_MAP[String(code)] || "Unknown"; }
function decodeLighting(code){ return LIGHTING_MAP[String(code)] || "Unknown"; }

// ------------ LOAD FILES ----------------
async function loadFiles() {
  async function fetchJSON(path){
    const res = await fetch(path);
    if(!res.ok) throw new Error("Cannot load "+path);
    return await res.json();
  }

  try {
    accidentsGeo = await fetchJSON("bikes.geojson");
    lanesGeo     = await fetchJSON("reseau_cyclable.json");
  } catch(e) {
    console.error(e);
    resultText.innerText = "Error loading data files.";
    return;
  }

  // Draw bike lanes
  L.geoJSON(lanesGeo, {
    pane:"roadsPane",
    style:{ color:"#003366", weight:2, opacity:0.9 }
  }).addTo(map);

  addBikeLaneLegend();
  buildVariableMenu();
  renderPreview();
}
loadFiles();

// ----------- VARIABLE MENU -----------
function buildVariableMenu() {
  const div = L.DomUtil.create("div","filters bg-white p-2 rounded shadow-sm");
  div.innerHTML = `
    <h6><b>Select variable</b></h6>
    <label><input type="radio" name="var" value="ACCIDENT_TYPE"> Accident Type</label><br>
    <label><input type="radio" name="var" value="CD_COND_METEO"> Weather</label><br>
    <label><input type="radio" name="var" value="CD_ECLRM"> Lighting</label><br>
    <label><input type="radio" name="var" value="ON_BIKELANE"> Bike Lane</label><br>
  `;

  const ctrl = L.control({position:"topright"});
  ctrl.onAdd = () => div;
  ctrl.addTo(map);

  div.querySelectorAll("input[name='var']").forEach(r => {
    r.addEventListener("change", e=>{
      selectedVariable = e.target.value;
      renderPreview();
    });
  });
}

// ----------- RENDER PREVIEW -----------
function renderPreview() {
  accidentsLayer.clearLayers();
  heatLayer.clearLayers();
  if(!accidentsGeo) return;

  accidentsGeo.features.forEach(f=>{
    const p = f.properties;
    const [lon,lat] = f.geometry.coordinates;

    let color = "gray";
    if(selectedVariable === "ACCIDENT_TYPE"){
      color = p.ACCIDENT_TYPE==="Fatal/Hospitalization" ? "red" :
              p.ACCIDENT_TYPE==="Injury" ? "yellow" : "green";
    }
    if(selectedVariable === "CD_COND_METEO"){
      color = "#"+((parseInt(p.CD_COND_METEO)||1)*123456 % 0xFFFFFF).toString(16).padStart(6,"0");
    }
    if(selectedVariable === "CD_ECLRM"){
      color = "#"+((parseInt(p.CD_ECLRM)||1)*654321 % 0xFFFFFF).toString(16).padStart(6,"0");
    }
    if(selectedVariable === "ON_BIKELANE"){
      color = p.ON_BIKELANE ? "green" : "red";
    }

    const marker = L.circleMarker([lat,lon],{
      pane:"collisionsPane",
      radius:4,
      fillColor:color,
      color:"#222",
      weight:1,
      fillOpacity:0.9
    });

    marker.bindPopup(`
      <b>ID:</b> ${p.NO_SEQ_COLL}<br>
      <b>Accident type:</b> ${p.ACCIDENT_TYPE}<br>
      <b>Weather:</b> ${decodeWeather(p.CD_COND_METEO)}<br>
      <b>Lighting:</b> ${decodeLighting(p.CD_ECLRM)}<br>
      <b>Bike Lane:</b> ${p.ON_BIKELANE ? "Yes" : "No"}
    `);

    accidentsLayer.addLayer(marker);
  });

  // Heatmap
  const pts = accidentsGeo.features.map(f=>[
    f.geometry.coordinates[1],
    f.geometry.coordinates[0],
    0.7
  ]);
  L.heatLayer(pts,{ pane:"heatPane", radius:25, blur:20 }).addTo(heatLayer);
}

// -------------- BIKE LANE LEGEND --------------
function addBikeLaneLegend(){
  const legend = L.control({position:"bottomleft"});
  legend.onAdd = function(){
    const div = L.DomUtil.create("div","results-bar");
    div.innerHTML = `<span style="background:#003366;width:20px;height:4px;display:inline-block;margin-right:5px;"></span>Bike lanes`;
    return div;
  };
  legend.addTo(map);
}
