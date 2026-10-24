<template>
  <div class="little-map-wrapper" :class="{ 'no-radius': noBorderRadius }">
    <div ref="mapContainer" class="map-container"></div>

    <!-- Custom bottom-right control: zoom + map actions (replaces native Leaflet zoom) -->
    <div v-if="!hideOverlay" class="map-overlay-bottomright">
      <div v-if="flightInfo"
        class="flight-info bg-white rounded-pill px-4 py-2 mr-3 elevation-2 text-body-2 d-flex align-center">
        <span class="font-weight-bold text-grey-darken-3">{{ flightInfo.date }}</span>
        <span class="mx-2 text-grey-lighten-1">|</span>
        <span class="font-weight-bold text-primary">{{ flightInfo.duration }}</span>
        <template v-if="trackCoords">
          <span class="mx-2 text-grey-lighten-1">|</span>
          <!-- Track colouring: plain, altitude, vario or speed -->
          <v-menu location="top end">
            <template v-slot:activator="{ props }">
              <button v-bind="props" type="button" class="track-mode-btn d-flex align-center">
                <span class="track-dot mr-2" :style="{ background: modeSwatch(trackMode) }"></span>
                <span class="font-weight-bold">{{ trackModeLabel(trackMode) }}</span>
                <v-icon size="18">mdi-menu-down</v-icon>
              </button>
            </template>
            <v-list density="compact">
              <v-list-item v-for="mode in TRACK_MODES" :key="mode" :active="mode === trackMode"
                @click="setTrackMode(mode)">
                <template v-slot:prepend>
                  <span class="track-dot mr-3" :style="{ background: modeSwatch(mode) }"></span>
                </template>
                <v-list-item-title>{{ trackModeLabel(mode) }}</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
          <span v-if="trackLegend" class="ml-2 text-caption text-grey-darken-2 d-flex align-center">
            {{ trackLegend.low }}
            <span class="legend-bar mx-1" :style="{ background: gradientCss }">
              <span v-if="trackLegend.mid" class="legend-mid">{{ trackLegend.mid }}</span>
            </span>
            {{ trackLegend.high }}
          </span>
        </template>
        <template v-if="scoreText && scoreVisible">
          <span class="mx-2 text-grey-lighten-1">|</span>
          <span class="score-dot mr-2"></span>
          <span class="font-weight-bold">{{ scoreText.title }}</span>
          <span class="ml-1 text-grey-darken-2">· {{ scoreText.detail }}</span>
        </template>
      </div>
      <div class="map-buttons">
        <v-tooltip :text="$gettext('Zoom in')" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" icon="mdi-plus" size="36" color="white" class="map-btn" @click="zoomIn"></v-btn>
          </template>
        </v-tooltip>
        <v-tooltip :text="$gettext('Zoom out')" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" icon="mdi-minus" size="36" color="white" class="map-btn" @click="zoomOut"></v-btn>
          </template>
        </v-tooltip>
        <v-tooltip :text="$gettext('Full map')" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" icon="mdi-fullscreen" size="36" color="white" class="map-btn"
              @click="$emit('open-full-map')"></v-btn>
          </template>
        </v-tooltip>
        <v-tooltip :text="$gettext('3D View')" location="top">
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" icon="mdi-video-3d" size="36" color="white" class="map-btn"
              @click="$emit('open-cesium')"></v-btn>
          </template>
        </v-tooltip>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from 'vue';
import { useGettext } from "vue3-gettext";

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createBaseMaps, getDefaultLayerName, createKk7 } from '@/js/leaflet/tiles.js';
import { startIcon, endIcon } from '@/js/leaflet/map-utils.js';
import {
  SCORE_COLOR, GRADIENT_CSS, TRACK_MODES as TRACK_MODE_LIST, readTrackMode, saveTrackMode,
  trackModeLabel as trackModeLabelOf, trackModeSwatch,
  scorePointLabel, scorePointTime, scoreLegLabel, scoreCircleOptions, scoreLineStyle
} from '@/js/leaflet/track-style.js';
import { TrackColorizer } from '@/js/leaflet/track-colorizer.js';

// Import site type icons
import windsockIconUrl from '@/assets/windsock22.png';
import arriveeIconUrl from '@/assets/arrivee22.png';
import flagYellowIconUrl from '@/assets/flag-yellow-22.png';

// Create Leaflet icons for site types
const takeoffIcon = L.icon({
  iconUrl: windsockIconUrl,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22]
});

const landingIcon = L.icon({
  iconUrl: arriveeIconUrl,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22]
});

const undefinedIcon = L.icon({
  iconUrl: flagYellowIconUrl,
  iconSize: [22, 22],
  iconAnchor: [11, 22],
  popupAnchor: [0, -22]
});

const { $gettext } = useGettext();

const props = defineProps({
  geoJson: {
    type: Object,
    default: null
  },
  scoreJson: {
    type: Object,
    default: null
  },
  hideOverlay: {
    type: Boolean,
    default: false
  },
  hideAnalyze: {
    type: Boolean,
    default: false
  },
  zoomLevel: {
    type: Number,
    default: 12
  },
  noBorderRadius: {
    type: Boolean,
    default: false
  },
  paddingLeft: {
    type: Number,
    default: 0
  },
  flightInfo: {
    type: Object,
    default: null
  },
  showSkyways: {
    type: Boolean,
    default: false
  },
  // Offset of the flight's local time (minutes), for the turnpoint times
  offsetUTC: {
    type: Number,
    default: 0
  },
  // Smoothed vario (m/s) and speed (km/h) of the track points, for the track colouring
  trackSeries: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['open-full-map', 'open-cesium', 'open-analyze']);

const mapContainer = ref(null);
let map = null;
let geoJsonLayer = null;
let scoreLayer = null;
// Scored course summary { title, detail } and whether its overlay is shown
const scoreText = ref(null);
const scoreVisible = ref(true);
let startMarker = null;
let endMarker = null;
let resizeObserver = null;
let layerControl = null;

onMounted(() => {
  // Initialiser la carte Leaflet — zoom control to top-right to avoid drawer overlap
  map = L.map(mapContainer.value, { zoomControl: false }).setView([45.0, 6.0], 10);
  // Native zoom control removed — replaced by custom [+][-][⛶][3D] button group

  // Create fresh tile layer instances for this map (avoid conflicts with other maps)
  const mapBaseLayers = createBaseMaps();

  // Use the OSM layer from baseMaps so it appears selected in the layer control
  mapBaseLayers[getDefaultLayerName()].addTo(map);

  // Ajouter le contrôleur de couches
  layerControl = L.control.layers(mapBaseLayers, null, { collapsed: false }).addTo(map);

  // Skyways overlay (kk7), same as the full map
  if (props.showSkyways) {
    layerControl.addOverlay(createKk7(), 'Skyways kk7.ch');
  }

  // IGC track, plain or coloured, below the scored course
  colorizer = new TrackColorizer(map, { $gettext });

  // The score summary of the badge follows the visibility of the score overlay
  map.on('overlayadd overlayremove', (e) => {
    if (e.layer === scoreLayer) scoreVisible.value = e.type === 'overlayadd';
  });

  // Forcer un rafraîchissement après un court délai
  setTimeout(() => {
    map.invalidateSize();
  }, 100);

  // Second invalidateSize for mobile: the container may still be resizing
  // after a CSS layout switch (e.g. v-if toggling ExternalLayout into view)
  setTimeout(() => {
    if (map) map.invalidateSize();
  }, 500);

  // ResizeObserver: recalculate map size whenever the container dimensions change
  if (window.ResizeObserver && mapContainer.value) {
    resizeObserver = new ResizeObserver(() => {
      if (map) map.invalidateSize();
    });
    resizeObserver.observe(mapContainer.value);
  }

  // Afficher le GeoJSON si disponible (trace du vol)
  if (props.geoJson) {
    displayGeoJson(props.geoJson);
  }

  // Afficher le scoring si disponible
  if (props.scoreJson) {
    displayScoreJson(props.scoreJson);
  }
});

// Watch pour la trace du vol
watch(() => props.geoJson, (newGeoJson) => {
  if (newGeoJson && map) {
    displayGeoJson(newGeoJson);
  }
});

// Watch pour le résultat du scoring
watch(() => props.scoreJson, (newScoreJson) => {
  if (newScoreJson && map) {
    displayScoreJson(newScoreJson);
  }
});

function displayGeoJson(geoJson) {

  // Supprimer la couche précédente de la trace si elle existe
  if (geoJsonLayer) {
    map.removeLayer(geoJsonLayer);
  }
  // Supprimer la couche précédente du scoring si elle existe
  clearScoreLayer();
  // Supprimer les marqueurs précédents
  if (startMarker) {
    map.removeLayer(startMarker);
    startMarker = null;
  }
  if (endMarker) {
    map.removeLayer(endMarker);
    endMarker = null;
  }

  // Ajouter la nouvelle couche GeoJSON (trace du vol)
  const trackFeature = geoJson.features?.find(f => f.geometry?.type === 'LineString');
  trackCoords.value = trackFeature ? trackFeature.geometry.coordinates : null;
  trackTimes = trackFeature?.properties?.coordTimes || null;
  drawTrack();

  // Ajouter les marqueurs de début et fin
  if (geoJson.features && geoJson.features.length > 0) {
    const trackFeature = geoJson.features.find(f => f.geometry.type === 'LineString')
    if (trackFeature) {
      const coords = trackFeature.geometry.coordinates
      if (coords.length > 0) {
        const startPoint = coords[0]
        const endPoint = coords[coords.length - 1]
        startMarker = L.marker([startPoint[1], startPoint[0]], { icon: startIcon }).addTo(map)
        endMarker = L.marker([endPoint[1], endPoint[0]], { icon: endIcon }).addTo(map)
      }
    }
  }


  // Adapter la vue pour afficher toute la trace et le scoring
  fitBoundsToAllLayers();

  // Forcer un rafraîchissement
  setTimeout(() => {
    map.invalidateSize();
  }, 50);
}

// Remove the scored course from the map, the layer control and the legend
function clearScoreLayer() {
  if (scoreLayer) {
    map.removeLayer(scoreLayer);
    if (layerControl) layerControl.removeLayer(scoreLayer);
    scoreLayer = null;
  }
  scoreText.value = null;
}

// Track colouring: plain orange track, or coloured by altitude, vario or speed (shared with the full map)
let colorizer = null;
const trackCoords = ref(null);
const trackMode = ref(readTrackMode());
const trackLegend = ref(null);
const gradientCss = GRADIENT_CSS;
const TRACK_MODES = TRACK_MODE_LIST;

function setTrackMode(mode) {
  trackMode.value = mode;
  saveTrackMode(mode);
  drawTrack();
}

function trackModeLabel(mode) {
  return trackModeLabelOf(mode, $gettext);
}

function modeSwatch(mode) {
  return trackModeSwatch(mode);
}

/**
 * (Re)draw the IGC track in the current colouring mode, below the scored course
 */
function drawTrack() {
  if (!colorizer) return;
  colorizer.setTrack(trackCoords.value, trackTimes, props.trackSeries);
  trackLegend.value = colorizer.draw(trackMode.value);
  geoJsonLayer = colorizer.layer;
}

let trackTimes = null;

function displayScoreJson(scoreJson) {

  // Supprimer la couche précédente du scoring si elle existe
  clearScoreLayer();

  try {
    // Ajouter la nouvelle couche GeoJSON (résultat du scoring)
    // Same look as the full map: turnpoints on click, leg distances on hover
    scoreLayer = L.geoJSON(scoreJson, {
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, scoreCircleOptions(feature)),
      style: scoreLineStyle,
      onEachFeature: (feature, layer) => {
        const id = String(feature.properties?.id || '');
        if (feature.geometry.type === 'Point') {
          const time = scorePointTime(feature.properties.timestamp, props.offsetUTC);
          layer.bindPopup(`<b>${scorePointLabel(id, $gettext)}</b>${time ? '<br>' + time : ''}`);
        } else if (feature.geometry.type === 'LineString') {
          layer.bindTooltip(scoreLegLabel(feature.properties, $gettext), { sticky: true });
        }
      }
    }).addTo(map);

    // Summary shown in the date/duration badge
    scoreText.value = scoreSummary(scoreJson);
    scoreVisible.value = true;
    if (layerControl) layerControl.addOverlay(scoreLayer, `<span style="color:${SCORE_COLOR}">●</span> ${scoreText.value.title}`);

    // Adapter la vue pour afficher toute la trace et le scoring
    fitBoundsToAllLayers();
  } catch (error) {
    console.error('Erreur lors de l\'affichage du scoring:', error);
  }
}

// Course type, scored distance and points of a scoring result
function scoreSummary(scoreJson) {
  const titles = {
    fai: $gettext('FAI triangle'),
    tri: $gettext('Flat triangle'),
    od: $gettext('Free distance')
  };
  // Scored distance: triangle distance minus the closing penalty, as XContest shows it
  const km = (scoreJson.distance || 0) - (scoreJson.penalty || 0);
  const pts = Number(scoreJson.score || 0);
  return {
    title: titles[scoreJson.code] || scoreJson.course || 'Score',
    detail: `${km.toFixed(1)} km · ${pts.toFixed(1)} pts${scoreJson.league ? ' (' + scoreJson.league + ')' : ''}`
  };
}

function fitBoundsToAllLayers() {
  try {
    const bounds = L.latLngBounds([]);
    let hasBounds = false;

    if (geoJsonLayer) {
      const geoBounds = geoJsonLayer.getBounds();
      if (geoBounds.isValid()) {
        bounds.extend(geoBounds);
        hasBounds = true;
      }
    }

    if (scoreLayer) {
      const scoreBounds = scoreLayer.getBounds();
      if (scoreBounds.isValid()) {
        bounds.extend(scoreBounds);
        hasBounds = true;
      }
    }

    if (hasBounds && bounds.isValid()) {
      // paddingLeft accounts for the left drawer width so the track isn't hidden under it
      map.fitBounds(bounds, {
        paddingTopLeft: [props.paddingLeft + 20, 20],
        paddingBottomRight: [20, 20]
      });
    }
  } catch (error) {
    console.error('Erreur lors de fitBounds:', error);
  }
}

/**
 * Display only a takeoff marker for flights without GPS track
 * @param {number} lat - Latitude of takeoff
 * @param {number} lon - Longitude of takeoff
 * @param {string} site - Site name
 * @param {number} alt - Altitude
 * @param {string} siteType - Site type ('D' for takeoff, 'A' for landing, other for undefined)
 */
function displayTakeoffOnly(lat, lon, site, alt, siteType = 'D') {
  // Clear existing layers
  if (geoJsonLayer) {
    map.removeLayer(geoJsonLayer);
    geoJsonLayer = null;
  }
  clearScoreLayer();
  trackCoords.value = null;
  if (startMarker) {
    map.removeLayer(startMarker);
  }
  if (endMarker) {
    map.removeLayer(endMarker);
    endMarker = null;
  }

  // Select icon based on site type
  let markerIcon;
  if (siteType === 'D') {
    markerIcon = takeoffIcon;
  } else if (siteType === 'A') {
    markerIcon = landingIcon;
  } else {
    markerIcon = undefinedIcon;
  }

  // Create the takeoff marker with popup
  const popupContent = `${site || 'Unknown'}<br>${alt || 0}m`;
  startMarker = L.marker([lat, lon], { icon: markerIcon })
    .bindPopup(popupContent)
    .addTo(map);

  // Center map on takeoff with custom zoom level
  map.setView([lat, lon], props.zoomLevel);

  // Open popup
  startMarker.openPopup();
}

function zoomIn() {
  if (map) map.zoomIn();
}

function zoomOut() {
  if (map) map.zoomOut();
}

/**
 * Display a hike GPS track (GeoJSON LineString)
 * @param {Object} geoJson - GeoJSON FeatureCollection with LineString feature
 */
function displayHikeTrack(geoJson) {
  if (!map || !geoJson) return;

  // Clear existing layers
  if (geoJsonLayer) { map.removeLayer(geoJsonLayer); geoJsonLayer = null; }
  clearScoreLayer();
  trackCoords.value = null;
  if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
  if (endMarker) { map.removeLayer(endMarker); endMarker = null; }

  // Display track
  geoJsonLayer = L.geoJSON(geoJson, {
    style: { color: '#3388ff', weight: 3, opacity: 0.8 }
  }).addTo(map);

  // Add start/end markers from first/last coordinate
  const feature = geoJson.features && geoJson.features.find(f => f.geometry && f.geometry.type === 'LineString');
  if (feature && feature.geometry.coordinates.length > 0) {
    const coords = feature.geometry.coordinates;
    const s = coords[0];
    const e = coords[coords.length - 1];
    startMarker = L.marker([s[1], s[0]], { icon: startIcon }).addTo(map);
    endMarker = L.marker([e[1], e[0]], { icon: endIcon }).addTo(map);
  }

  // Fit bounds
  try {
    const bounds = geoJsonLayer.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  } catch (_) { /* ignore */ }

  setTimeout(() => { if (map) map.invalidateSize(); }, 50);
}

/**
 * Display two markers (start and end) for a hike without GPS track
 * @param {number} latStart - Start latitude
 * @param {number} lonStart - Start longitude
 * @param {number} latEnd - End latitude
 * @param {number} lonEnd - End longitude
 * @param {string} name - Hike name for popup
 */
function displayHikePoints(latStart, lonStart, latEnd, lonEnd, name) {
  if (!map) return;

  // Clear existing layers
  if (geoJsonLayer) { map.removeLayer(geoJsonLayer); geoJsonLayer = null; }
  clearScoreLayer();
  trackCoords.value = null;
  if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
  if (endMarker) { map.removeLayer(endMarker); endMarker = null; }

  const hasStart = latStart && lonStart;
  const hasEnd = latEnd && lonEnd;

  if (hasStart) {
    startMarker = L.marker([latStart, lonStart], { icon: startIcon })
      .bindPopup(`${name || ''} - Start`)
      .addTo(map);
  }

  if (hasEnd && (latEnd !== latStart || lonEnd !== lonStart)) {
    endMarker = L.marker([latEnd, lonEnd], { icon: endIcon })
      .bindPopup(`${name || ''} - End`)
      .addTo(map);
  }

  // Fit map to show both markers
  if (hasStart && hasEnd) {
    const bounds = L.latLngBounds([[latStart, lonStart], [latEnd, lonEnd]]);
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  } else if (hasStart) {
    map.setView([latStart, lonStart], props.zoomLevel);
    if (startMarker) startMarker.openPopup();
  }

  setTimeout(() => { if (map) map.invalidateSize(); }, 50);
}

defineExpose({
  displayTakeoffOnly,
  displayHikeTrack,
  displayHikePoints
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (map) {
    map.remove();
  }
});
</script>

<style scoped>
.little-map-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 10px;
  overflow: hidden;
}

.map-container {
  width: 100%;
  height: 100%;
}

.map-overlay-bottomright {
  position: absolute;
  right: 10px;
  bottom: calc(10px + env(safe-area-inset-bottom, 0px));
  z-index: 1000;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.map-buttons {
  pointer-events: auto;
  /* Enable clicks on buttons */
  background: rgba(255, 255, 255, 0.9);
  padding: 4px;
  border-radius: 20px;
  display: flex;
  gap: 8px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.map-btn {
  background-color: #1976D2 !important;
  /* Vuetify primary blue - or custom */
  color: white !important;
}

.little-map-wrapper.no-radius {
  border-radius: 0;
}

/* Track colouring selector of the date/duration badge */
.track-mode-btn {
  /* The overlay lets clicks through to the map: re-enable them on the selector */
  pointer-events: auto;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font: inherit;
}

.track-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.legend-bar {
  position: relative;
  display: inline-block;
  width: 70px;
  height: 8px;
  border-radius: 2px;
}

/* "0" in the middle of the vario scale */
.legend-mid {
  position: absolute;
  left: 50%;
  top: -14px;
  transform: translateX(-50%);
  font-size: 10px;
  line-height: 1;
}

/* Colour mark of the scored course in the date/duration badge (same as SCORE_COLOR) */
.score-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #D50000;
}
</style>
