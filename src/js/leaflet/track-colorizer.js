import L from 'leaflet';
import {
  TRACK_COLOR, trackModeValues, buildGradientTrack, nearestTrackPoint, formatTrackValue
} from '@/js/leaflet/track-style.js';

// Distance (px) from the track under which the hover shows the value
const HOVER_DISTANCE_PX = 15;
// Minimum delay between two hover lookups (ms)
const HOVER_THROTTLE_MS = 60;

/**
 * Draws an IGC track plain orange or coloured by altitude, vario or speed,
 * with the value at the nearest point shown on hover. Shared by the logbook map and the full map.
 * The track goes in its own pane, below the overlays (scored course, markers).
 */
export class TrackColorizer {
  /**
   * @param {Object} map Leaflet map
   * @param {Object} options { $gettext, weight, drawPlain: also draw the plain orange track (default true) }
   */
  constructor(map, options) {
    this.map = map;
    this.$gettext = options.$gettext;
    this.weight = options.weight || 3;
    this.drawPlain = options.drawPlain !== false;
    if (!map.getPane('trackPane')) {
      map.createPane('trackPane');
      map.getPane('trackPane').style.zIndex = 390;
    }
    // Canvas: thousands of short segments draw much faster than in SVG
    this.renderer = L.canvas({ pane: 'trackPane', padding: 0.5 });
    this.layer = null;
    this.coords = null;
    this.times = null;
    this.series = null;
    this.values = null;
    this.mode = 'flight';
    this.hoverTooltip = null;
    this.lastHover = 0;
    this.onMouseMove = (e) => this.hover(e);
    this.onMouseOut = () => this.hideHover();
    map.on('mousemove', this.onMouseMove);
    map.on('mouseout', this.onMouseOut);
  }

  /**
   * @param {Array} coords GeoJSON coordinates [lon, lat, alt]
   * @param {Array} times local ISO times of the coordinates (GeoJSON coordTimes)
   * @param {Object} series { vz, speed } from the IGC decoder
   */
  setTrack(coords, times, series) {
    this.coords = coords && coords.length >= 2 ? coords : null;
    this.times = times || null;
    this.series = series || null;
  }

  /**
   * (Re)draw the track in a colouring mode
   * @returns {Object|null} legend { low, mid, high } of a coloured mode, null for the plain track
   */
  draw(mode) {
    this.mode = mode;
    this.clear();
    if (!this.coords) return null;
    const values = mode === 'flight' ? null : trackModeValues(mode, this.coords, this.series);
    const lineOptions = { weight: this.weight, renderer: this.renderer, pane: 'trackPane' };
    if (!values) {
      if (!this.drawPlain) return null;
      this.layer = L.polyline(this.coords.map(c => [c[1], c[0]]), {
        ...lineOptions, color: TRACK_COLOR, opacity: 0.9
      }).addTo(this.map);
      return null;
    }
    this.values = values;
    const { layer, legend } = buildGradientTrack(L, this.coords, values, mode, lineOptions, this.$gettext);
    this.layer = layer.addTo(this.map);
    return legend;
  }

  clear() {
    if (this.layer) {
      this.map.removeLayer(this.layer);
      this.layer = null;
    }
    this.values = null;
    this.hideHover();
  }

  // Value and time of the nearest track point under the mouse
  hover(e) {
    if (!this.values || !this.coords) return;
    const now = Date.now();
    if (now - this.lastHover < HOVER_THROTTLE_MS) return;
    this.lastHover = now;
    const best = nearestTrackPoint(this.map, this.coords, this.map.latLngToContainerPoint(e.latlng), HOVER_DISTANCE_PX);
    if (best < 0) {
      this.hideHover();
      return;
    }
    const time = this.times?.[best] ? String(this.times[best]).slice(11, 19) : '';
    const html = `<b>${formatTrackValue(this.mode, this.values[best])}</b>${time ? ' · ' + time : ''}`;
    const latlng = [this.coords[best][1], this.coords[best][0]];
    if (!this.hoverTooltip) {
      this.hoverTooltip = L.tooltip({ direction: 'top', offset: [0, -6] }).setLatLng(latlng).setContent(html).addTo(this.map);
    } else {
      this.hoverTooltip.setLatLng(latlng).setContent(html);
    }
  }

  hideHover() {
    if (this.hoverTooltip) {
      this.hoverTooltip.remove();
      this.hoverTooltip = null;
    }
  }

  destroy() {
    this.clear();
    this.map.off('mousemove', this.onMouseMove);
    this.map.off('mouseout', this.onMouseOut);
  }
}
