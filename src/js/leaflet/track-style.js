/**
 * Colours and labels shared by the logbook map (LittleMapView) and the full map (MapLeaflet)
 */

// IGC track
export const TRACK_COLOR = '#FF8C00';
// Gradient of a track coloured by altitude, vario or speed: low values navy, high values red
export const GRADIENT_STOPS = ['#0d1b6e', '#4fc3f7', '#43a047', '#fdd835', '#fb8c00', '#d50000'];

/**
 * Colour of a position in the gradient
 * @param {number} t 0 (navy) to 1 (red)
 */
export function gradientColor(t) {
  const pos = Math.min(1, Math.max(0, t)) * (GRADIENT_STOPS.length - 1);
  const i = Math.min(Math.floor(pos), GRADIENT_STOPS.length - 2);
  const a = parseInt(GRADIENT_STOPS[i].slice(1), 16), b = parseInt(GRADIENT_STOPS[i + 1].slice(1), 16);
  const f = pos - i;
  const ch = shift => Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

// Value of a sorted array at a percentile (0-1)
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

/**
 * Scale of a track colouring: values below `low` are navy, above `high` red
 * @param {string} mode 'altitude' | 'vario' | 'speed'
 * @param {number[]} values
 * @returns {{low: number, high: number}} for altitude, low > high (high altitude is navy)
 */
export function colorScale(mode, values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((x, y) => x - y);
  if (mode === 'vario') {
    // Symmetric around 0: climbs red, sinks navy
    const m = Math.min(5, Math.max(2, Math.abs(percentile(sorted, 0.05)), Math.abs(percentile(sorted, 0.95))));
    return { low: -m, high: m };
  }
  if (mode === 'altitude') {
    // Inverted: high altitude navy, low altitude red
    return { low: percentile(sorted, 0.98), high: percentile(sorted, 0.02) };
  }
  return { low: percentile(sorted, 0.05), high: percentile(sorted, 0.95) };
}
// Scored course: legs, turnpoints, closing line
export const SCORE_COLOR = '#D50000';

// ---- Track colouring (logbook map and full map) ----

export const TRACK_MODES = ['flight', 'altitude', 'vario', 'speed'];
const TRACK_MODE_KEY = 'logfly.trackColorMode';
export const GRADIENT_CSS = `linear-gradient(90deg, ${GRADIENT_STOPS.join(', ')})`;
// Number of colour buckets: one polyline per run of points in the same bucket
const COLOR_BUCKETS = 24;
// Minimum number of points of a colour run (about 8 s of flight at 1 Hz),
// else vario and speed give one polyline every few points
const MIN_RUN_POINTS = 8;
// Plausible bounds of each value: GPS jumps give impossible varios and speeds
const VALUE_LIMITS = {
  altitude: [-500, 9000],
  vario: [-25, 10],
  speed: [0, 150]
};

// Colouring mode remembered for the logbook and the full map
export function readTrackMode() {
  try {
    const mode = localStorage.getItem(TRACK_MODE_KEY);
    return TRACK_MODES.includes(mode) ? mode : 'flight';
  } catch {
    return 'flight';
  }
}

export function saveTrackMode(mode) {
  try { localStorage.setItem(TRACK_MODE_KEY, mode); } catch { /* private mode */ }
}

export function trackModeLabel(mode, $gettext) {
  return {
    flight: $gettext('Flight'),
    altitude: $gettext('Altitude'),
    vario: $gettext('Vario'),
    speed: $gettext('Speed')
  }[mode];
}

// Dot of a mode in the selector: orange track or gradient
export function trackModeSwatch(mode) {
  return mode === 'flight' ? TRACK_COLOR : GRADIENT_CSS;
}

export function formatTrackValue(mode, v) {
  if (mode === 'altitude') return `${Math.round(v)} m`;
  if (mode === 'vario') return `${v > 0 ? '+' : ''}${v.toFixed(1)} m/s`;
  return `${Math.round(v)} km/h`;
}

/**
 * Clamp values to [min, max]; NaN or infinite values take the previous valid value
 * (or the first valid one at the start of the track, or 0 if there is none)
 */
function cleanValues(values, [min, max]) {
  const firstValid = values.find(v => Number.isFinite(v));
  let last = Number.isFinite(firstValid) ? firstValid : 0;
  return values.map(v => {
    if (Number.isFinite(v)) last = Math.min(max, Math.max(min, v));
    return last;
  });
}

/**
 * Value of each track point for a colouring mode
 * @param {string} mode 'altitude' | 'vario' | 'speed'
 * @param {Array} coords GeoJSON coordinates [lon, lat, alt]
 * @param {Object} series { vz, speed } from the IGC decoder (may be indexed differently from coords)
 * @returns {number[]|null}
 */
export function trackModeValues(mode, coords, series) {
  let raw;
  if (mode === 'altitude') {
    raw = coords.map(c => Number(c[2]));
  } else {
    const values = series?.[mode === 'vario' ? 'vz' : 'speed'];
    if (!values || values.length === 0) return null;
    const ratio = values.length / coords.length;
    raw = coords.map((c, i) => Number(values[Math.min(values.length - 1, Math.floor(i * ratio))]));
  }
  return cleanValues(raw, VALUE_LIMITS[mode]);
}

/**
 * Track drawn with the gradient, as runs of polylines grouped by colour bucket
 * @param {Object} L Leaflet
 * @param {Array} coords GeoJSON coordinates
 * @param {number[]} values one per coordinate
 * @param {string} mode
 * @param {Object} lineOptions Leaflet polyline options (weight, renderer, pane...)
 * @returns {{layer: Object, legend: {low, mid, high}}}
 */
export function buildGradientTrack(L, coords, values, mode, lineOptions, $gettext) {
  const scale = colorScale(mode, values);
  // A constant range gives a single colour instead of a division by 0
  const span = scale.high - scale.low || 1;
  const bucketOf = v => Math.min(COLOR_BUCKETS - 1, Math.max(0, Math.floor(((v - scale.low) / span) * COLOR_BUCKETS)));
  const colorOf = bucket => gradientColor((bucket + 0.5) / COLOR_BUCKETS);
  const layer = L.featureGroup();
  let run = [[coords[0][1], coords[0][0]]];
  let runBucket = bucketOf(values[1]);
  for (let i = 1; i < coords.length; i++) {
    const bucket = bucketOf(values[i]);
    if (bucket !== runBucket && run.length > MIN_RUN_POINTS) {
      L.polyline(run, { ...lineOptions, color: colorOf(runBucket), opacity: 1 }).addTo(layer);
      // The next run starts where this one ends
      run = [run[run.length - 1]];
      runBucket = bucket;
    }
    run.push([coords[i][1], coords[i][0]]);
  }
  L.polyline(run, { ...lineOptions, color: colorOf(runBucket), opacity: 1 }).addTo(layer);
  const isVario = mode === 'vario';
  return {
    layer,
    legend: {
      low: formatTrackValue(mode, scale.low) + (isVario ? ` (${$gettext('sink')})` : ''),
      mid: isVario ? '0' : null,
      high: formatTrackValue(mode, scale.high) + (isVario ? ` (${$gettext('climb')})` : '')
    }
  };
}

/**
 * Index of the track point nearest to a container point, within maxPx pixels (-1 if none)
 */
export function nearestTrackPoint(map, coords, containerPoint, maxPx) {
  let best = -1, bestD2 = maxPx * maxPx;
  const step = Math.max(1, Math.floor(coords.length / 20000));
  for (let i = 0; i < coords.length; i += step) {
    const p = map.latLngToContainerPoint([coords[i][1], coords[i][0]]);
    const d2 = (p.x - containerPoint.x) ** 2 + (p.y - containerPoint.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  return best;
}

/**
 * Readable name of a scoring point: tp0 -> Turnpoint 1, cp_in -> Closing in...
 * @param {string} id
 * @param {Function} $gettext
 */
export function scorePointLabel(id, $gettext) {
  if (id.startsWith('tp')) return `${$gettext('Turnpoint')} ${parseInt(id.substring(2)) + 1}`;
  if (id === 'cp_in') return $gettext('Closing in');
  if (id === 'cp_out') return $gettext('Closing out');
  return id.toUpperCase();
}

/**
 * Local time (HH:mm:ss) of a scoring point
 * @param {number} timestamp ms
 * @param {number} offsetUTC minutes
 */
export function scorePointTime(timestamp, offsetUTC) {
  if (!timestamp) return '';
  const date = new Date(timestamp + (Number(offsetUTC) || 0) * 60000);
  return date.toISOString().slice(11, 19);
}

/**
 * Hover label of a leg: "Leg 1 : 43.54 km", "Closing : 2.89 km"
 * @param {Object} properties feature properties { id, d }
 * @param {Function} $gettext
 */
export function scoreLegLabel(properties, $gettext) {
  const id = String(properties?.id || '');
  const km = Number(properties?.d || 0).toFixed(2);
  const label = id === 'closing'
    ? $gettext('Closing')
    : `${$gettext('Leg')} ${parseInt(id.replace('seg', '')) + 1 || ''}`;
  return `<b>${label}</b> : ${km} km`;
}

/**
 * Leaflet styles of a scoring GeoJSON (circle markers for points, dashed closing line)
 * @param {Object} [renderer] Leaflet renderer
 */
export function scoreCircleOptions(feature, renderer) {
  const isTurnpoint = String(feature.properties?.id || '').startsWith('tp');
  return {
    ...(renderer ? { renderer } : {}),
    radius: isTurnpoint ? 7 : 4,
    fillColor: SCORE_COLOR,
    color: '#ffffff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.95
  };
}

export function scoreLineStyle(feature) {
  const closing = feature.properties?.id === 'closing';
  return {
    color: SCORE_COLOR,
    weight: 2,
    opacity: 0.95,
    dashArray: closing ? '8 8' : null
  };
}
