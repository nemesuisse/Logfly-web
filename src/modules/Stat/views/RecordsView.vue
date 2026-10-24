<template>
  <OpenLogbook :show="true" />
  <v-card v-if="databaseStore.hasOpenDatabase" flat class="records-card">
    <!-- Header: league and track analysis progress -->
    <div class="records-header">
      <v-icon size="28" color="primary">mdi-trophy</v-icon>
      <span class="text-h6">{{ $gettext('Records') }}</span>
      <v-chip size="small" color="primary" variant="tonal">{{ $gettext('Scoring') }} {{ league }}</v-chip>
      <v-spacer />
      <div v-if="computing" class="progress-box">
        <span class="text-caption">
          {{ $gettext('Analyzing tracks') }} {{ progress.done }} / {{ progress.total }}
        </span>
        <v-progress-linear :model-value="progressPercent" color="primary" height="6" rounded />
      </div>
      <v-btn v-else size="small" variant="text" prepend-icon="mdi-refresh" @click="recomputeAll"
        :title="$gettext('Recompute altitudes and scores of all tracks')">
        {{ $gettext('Recompute') }}
      </v-btn>
    </div>

    <!-- Panels -->
    <div class="panels-grid">
      <v-card v-for="panel in panels" :key="panel.key" class="record-panel" elevation="2">
        <div class="panel-title" :style="{ background: `linear-gradient(135deg, ${panel.colors[0]} 0%, ${panel.colors[1]} 100%)` }">
          <CourseIcon v-if="panel.course" class="panel-icon" :course="panel.course" :size="72" color="white" />
          <v-icon v-else class="panel-icon" size="72" color="white">{{ panel.icon }}</v-icon>
          <span>{{ panel.title }}</span>
          <v-menu v-if="panel.key === 'speed'">
            <template v-slot:activator="{ props }">
              <button v-bind="props" class="speed-filter" type="button">
                &gt; {{ speedMinKm }} km<v-icon size="20">mdi-menu-down</v-icon>
              </button>
            </template>
            <v-list density="compact">
              <v-list-item v-for="km in speedMinKmItems" :key="km" :active="km === speedMinKm"
                :title="`> ${km} km`" @click="setSpeedMinKm(km)" />
            </v-list>
          </v-menu>
        </div>
        <v-table v-if="panel.rows.length > 0" density="compact" class="record-table">
          <tbody>
            <tr v-for="(row, index) in panel.rows" :key="index" class="record-row" @click="openRow(row)"
              :title="row.link.name === 'sites-view' ? $gettext('Open the site') : $gettext('Open the flight')">
              <td class="rank-cell">
                <v-icon v-if="index < 3" size="18" :color="medalColors[index]">mdi-medal</v-icon>
                <span v-else class="rank-number">{{ index + 1 }}</span>
              </td>
              <td class="value-cell">
                <CourseIcon v-if="rowCourse(row)" class="row-course-icon" :course="rowCourse(row)" :size="46" />
                <div class="record-value">{{ row.value }}</div>
                <div v-if="row.extra" class="record-extra">{{ row.extra }}</div>
              </td>
              <td class="detail-cell">
                <div class="record-date">{{ row.date }}</div>
                <div class="record-site">{{ row.site }}</div>
              </td>
            </tr>
          </tbody>
        </v-table>
        <div v-else class="panel-empty">
          <template v-if="panel.key === 'speed' && !computing">{{ $gettext('No matching flight') }}</template>
          <template v-else>
            {{ panel.needsTracks && computing ? $gettext('Analyzing tracks') + '...' : $gettext('No data') }}
          </template>
        </div>
      </v-card>
    </div>
    <!-- Flight full map, opened from a row -->
    <v-dialog v-model="showFullMap" fullscreen persistent transition="dialog-bottom-transition">
      <FullMapView v-if="fullMapFlight" :flightData="fullMapFlight" @close="onFullMapClose" />
    </v-dialog>
    <v-overlay :model-value="loadingFlight" class="align-center justify-center" persistent>
      <v-progress-circular indeterminate size="56" color="white" />
    </v-overlay>
  </v-card>
  <!-- No database message -->
  <v-card v-else flat class="records-card d-flex align-center justify-center">
    <v-card-text class="text-center">
      <v-icon size="64" color="grey">mdi-database-off</v-icon>
      <h3 class="mt-4">{{ $gettext('No logbook opened') }}</h3>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useGettext } from "vue3-gettext";
import { useRouter } from 'vue-router';
import OpenLogbook from '@/components/OpenLogbook.vue';
import FullMapView from '@/components/FullMapView.vue';
import CourseIcon from '@/modules/Stat/components/CourseIcon.vue';
import { useDatabaseStore } from '@/stores/database';
import { igcDecoding } from '@/js/igc/igc-decoder.js';
import { IgcAnalyze } from '@/js/igc/igc-analyzer.js';
import {
  ensurePerfTable, getRecordsLeague, getFlightsToCompute, computeFlightPerf, perfKey
} from '@/modules/Stat/js/flight-perf.js';

const databaseStore = useDatabaseStore();
const { $gettext } = useGettext();
const router = useRouter();

const TOP = 5;
const medalColors = ['#FFC107', '#9E9E9E', '#A1887F'];

const league = ref(getRecordsLeague());
const computing = ref(false);
const progress = ref({ done: 0, total: 0 });
let stopRequested = false;

const records = ref({
  longest: [], altitude: [], best: [], fai: [], tri: [], od: [], speed: [], sites: [], streaks: []
});

// Average speed panel: only flights longer than this distance (km)
const speedMinKm = ref(30);
const speedMinKmItems = [30, 50, 100, 200];

function setSpeedMinKm(km) {
  speedMinKm.value = km;
  loadPerfRecords();
}

const progressPercent = computed(() =>
  progress.value.total > 0 ? (progress.value.done / progress.value.total) * 100 : 0
);

const courseLabels = computed(() => ({
  od: $gettext('Free distance'),
  tri: $gettext('Flat triangle'),
  fai: $gettext('FAI triangle')
}));

// Best scoring course of each analyzed flight: { V_ID: 'od' | 'tri' | 'fai' }
const bestCourseById = ref({});

// Full map of a flight opened from a row
const showFullMap = ref(false);
const fullMapFlight = ref(null);
const loadingFlight = ref(false);

const panels = computed(() => [
  { key: 'best', title: $gettext('Best scores'), icon: 'mdi-trophy-outline', colors: ['#FF9800', '#EF6C00'], rows: records.value.best, needsTracks: true },
  { key: 'fai', title: $gettext('Best FAI triangles'), icon: 'mdi-triangle-outline', course: 'fai', colors: ['#f44336', '#c62828'], rows: records.value.fai, needsTracks: true },
  { key: 'tri', title: $gettext('Best flat triangles'), icon: 'mdi-vector-triangle', course: 'tri', colors: ['#AB47BC', '#7B1FA2'], rows: records.value.tri, needsTracks: true },
  { key: 'od', title: $gettext('Best free distances'), icon: 'mdi-vector-polyline', course: 'od', colors: ['#26A69A', '#00796B'], rows: records.value.od, needsTracks: true },
  { key: 'longest', title: $gettext('Longest flights'), icon: 'mdi-timer-outline', colors: ['#2196F3', '#1565C0'], rows: records.value.longest },
  { key: 'speed', title: $gettext('Average speed'), icon: 'mdi-speedometer', colors: ['#78909C', '#455A64'], rows: records.value.speed, needsTracks: true },
  { key: 'altitude', title: $gettext('Altitude records'), icon: 'mdi-image-filter-hdr', colors: ['#4CAF50', '#2E7D32'], rows: records.value.altitude, needsTracks: true },
  { key: 'sites', title: $gettext('Most visited sites'), icon: 'mdi-map-marker-multiple', colors: ['#8D6E63', '#5D4037'], rows: records.value.sites },
  { key: 'streaks', title: $gettext('Longest flying streaks'), icon: 'mdi-calendar-check', colors: ['#5C6BC0', '#283593'], rows: records.value.streaks }
]);

onMounted(() => {
  if (databaseStore.hasOpenDatabase) init();
});

watch(() => databaseStore.hasOpenDatabase, (hasDb) => {
  if (hasDb) init();
});

onBeforeUnmount(() => {
  stopRequested = true;
});

function init() {
  league.value = getRecordsLeague();
  ensurePerfTable(databaseStore);
  loadSqlRecords();
  loadPerfRecords();
  computeMissing();
}

function rows(sql) {
  const result = databaseStore.query(sql);
  if (result.success && result.data && result.data[0]) return result.data[0].values;
  return [];
}

function flightLink(flightId) {
  return { name: 'logbook-view', query: { flight: flightId } };
}

function rowFlightId(row) {
  return row.link.name === 'logbook-view' ? row.link.query.flight : null;
}

function rowCourse(row) {
  const flightId = rowFlightId(row);
  return flightId ? bestCourseById.value[flightId] : null;
}

function openRow(row) {
  const flightId = rowFlightId(row);
  if (flightId) {
    openFlightFullMap(flightId);
  } else {
    router.push(row.link);
  }
}

/**
 * Open the full map of a flight, as in the logbook.
 * Flights without a track open in the logbook instead.
 */
async function openFlightFullMap(flightId) {
  const res = rows(`SELECT V_IGC, strftime('%d-%m-%Y', V_Date), V_Site, V_Engin, V_Commentaire, V_sDuree
    FROM Vol WHERE V_ID = ${flightId}`);
  const [strIgc, day, site, glider, comment, duration] = res[0] || [];
  if (!strIgc || strIgc.trim() === '') {
    router.push(flightLink(flightId));
    return;
  }
  loadingFlight.value = true;
  try {
    const decodedIgc = await igcDecoding(strIgc);
    if (!decodedIgc.success) {
      router.push(flightLink(flightId));
      return;
    }
    const analyzeIgc = await IgcAnalyze(decodedIgc.data.fixes);
    fullMapFlight.value = {
      dbId: flightId,
      day, site, glider, comment, duration,
      anaTrack: analyzeIgc.success ? analyzeIgc.anaTrack : null,
      decodedIgc: decodedIgc.data,
      rawIgc: strIgc,
      hikeData: null
    };
    showFullMap.value = true;
  } finally {
    loadingFlight.value = false;
  }
}

function onFullMapClose() {
  showFullMap.value = false;
  fullMapFlight.value = null;
  // The track may have been cut in the full map
  loadSqlRecords();
  loadPerfRecords();
  computeMissing();
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}mn`;
}

// 'YYYY-MM-DD...' -> 'DD-MM-YYYY'
function formatDate(sqlDate) {
  if (!sqlDate) return '';
  const [y, m, d] = String(sqlDate).substring(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

function formatKm(km) {
  return `${Number(km).toFixed(2)} km`;
}

function formatPts(pts) {
  return `${Number(pts).toFixed(2)} pts`;
}

/**
 * Records computed directly from the Vol table
 */
function loadSqlRecords() {
  records.value.longest = rows(`SELECT V_ID, V_Duree, V_Date, V_Site, V_Engin FROM Vol
    WHERE V_Duree > 0 ORDER BY V_Duree DESC LIMIT ${TOP}`)
    .map(([id, duree, date, site, glider]) => ({
      value: formatDuration(duree), extra: glider, date: formatDate(date), site, link: flightLink(id)
    }));

  records.value.sites = rows(`SELECT V_Site, COUNT(*) AS Nb, SUM(V_Duree) AS Total, MAX(V_Date) FROM Vol
    WHERE V_Site IS NOT NULL AND V_Site != '' GROUP BY V_Site ORDER BY Nb DESC, Total DESC LIMIT ${TOP}`)
    .map(([site, nb, total, last]) => ({
      value: site, extra: `${nb} ${$gettext('flights')} · ${formatDuration(total)}`,
      date: formatDate(last), site: $gettext('Last flight'),
      link: { name: 'sites-view', query: { site } }
    }));

  records.value.streaks = computeStreaks(rows(`SELECT date(V_Date) AS Day, COUNT(*),
    (SELECT V_ID FROM Vol AS First WHERE date(First.V_Date) = date(Vol.V_Date) ORDER BY First.V_Date LIMIT 1)
    FROM Vol WHERE V_Date IS NOT NULL GROUP BY Day ORDER BY Day`));
}

/**
 * Longest series of consecutive flying days
 * @param {Array} days [['YYYY-MM-DD', nbFlights, firstFlightId], ...] sorted ascending
 */
function computeStreaks(days) {
  const dayMs = 24 * 3600 * 1000;
  const streaks = [];
  let current = null;
  for (const [day, nb, firstId] of days) {
    if (!day) continue;
    const time = Date.parse(day + 'T00:00:00Z');
    if (current && Math.round((time - current.lastTime) / dayMs) === 1) {
      current.days++;
      current.flights += nb;
      current.end = day;
      current.lastTime = time;
    } else {
      current = { start: day, end: day, days: 1, flights: nb, lastTime: time, firstId };
      streaks.push(current);
    }
  }
  return streaks
    .sort((a, b) => b.days - a.days || b.flights - a.flights || b.end.localeCompare(a.end))
    .slice(0, TOP)
    .map(s => ({
      value: `${s.days} ${s.days > 1 ? $gettext('days') : $gettext('day')}`,
      extra: `${s.flights} ${$gettext('flights')}`,
      date: formatDate(s.start),
      site: s.days > 1 ? `→ ${formatDate(s.end)}` : '',
      link: flightLink(s.firstId)
    }));
}

/**
 * Records computed from the Perf cache (track analysis)
 */
function loadPerfRecords() {
  records.value.altitude = rows(`SELECT V_ID, P_MaxAlt, V_Date, V_Site FROM Perf JOIN Vol ON V_ID = P_V_ID
    WHERE P_MaxAlt IS NOT NULL ORDER BY P_MaxAlt DESC LIMIT ${TOP}`)
    .map(([id, alt, date, site]) => ({ value: `${alt} m`, date: formatDate(date), site, link: flightLink(id) }));

  const perfRows = rows(`SELECT V_ID, V_Date, V_Site, V_Duree, P_OdKm, P_OdPts, P_TriKm, P_TriPts, P_FaiKm, P_FaiPts
    FROM Perf JOIN Vol ON V_ID = P_V_ID WHERE P_League = '${perfKey(league.value)}'`)
    .map(([id, date, site, duree, odKm, odPts, triKm, triPts, faiKm, faiPts]) => ({
      id, date: formatDate(date), site, duree, link: flightLink(id),
      od: odPts ? { km: odKm, pts: odPts } : null,
      tri: triPts ? { km: triKm, pts: triPts } : null,
      fai: faiPts ? { km: faiKm, pts: faiPts } : null
    }));

  // Best scoring course of each flight
  const bestRows = perfRows
    .map(r => {
      const bestCode = ['od', 'tri', 'fai']
        .filter(code => r[code])
        .sort((a, b) => r[b].pts - r[a].pts)[0];
      return bestCode ? { ...r, bestCode, best: r[bestCode] } : null;
    })
    .filter(r => r);
  bestCourseById.value = Object.fromEntries(bestRows.map(r => [r.id, r.bestCode]));

  // Course panels: a flight only counts in the course of its best score
  for (const code of ['od', 'tri', 'fai']) {
    records.value[code] = bestRows
      .filter(r => r.bestCode === code)
      .sort((a, b) => b.best.pts - a.best.pts)
      .slice(0, TOP)
      .map(r => ({
        value: formatPts(r.best.pts), extra: formatKm(r.best.km), date: r.date, site: r.site, link: r.link
      }));
  }

  // Average speed: distance of the best scoring course over the flight duration
  records.value.speed = bestRows
    .filter(r => r.duree > 0 && r.best.km > speedMinKm.value)
    .map(r => ({ ...r, speed: r.best.km / (r.duree / 3600) }))
    .sort((a, b) => b.speed - a.speed)
    .slice(0, TOP)
    .map(r => ({
      value: `${r.speed.toFixed(1)} km/h`,
      extra: `${courseLabels.value[r.bestCode]} · ${formatKm(r.best.km)} · ${formatDuration(r.duree)}`,
      date: r.date, site: r.site, link: r.link
    }));

  records.value.best = [...bestRows]
    .sort((a, b) => b.best.pts - a.best.pts)
    .slice(0, TOP)
    .map(r => ({
      value: formatPts(r.best.pts),
      extra: `${courseLabels.value[r.bestCode]} · ${formatKm(r.best.km)}`,
      date: r.date, site: r.site, link: r.link
    }));
}

/**
 * Analyze tracks not yet in the Perf cache, refreshing the panels as results come in
 */
async function computeMissing() {
  if (computing.value) return;
  const ids = getFlightsToCompute(databaseStore, league.value);
  if (ids.length === 0) return;

  computing.value = true;
  stopRequested = false;
  progress.value = { done: 0, total: ids.length };
  let pending = 0;
  try {
    for (const id of ids) {
      const completed = await computeFlightPerf(databaseStore, id, league.value, () => stopRequested);
      if (!completed) break;
      progress.value.done++;
      pending++;
      if (pending >= 10) {
        // Save to the logbook in batches to avoid an autosave per flight
        databaseStore.markAsDirty();
        loadPerfRecords();
        pending = 0;
      }
    }
  } finally {
    if (pending > 0) databaseStore.markAsDirty();
    if (!stopRequested) loadPerfRecords();
    computing.value = false;
  }
}

function recomputeAll() {
  databaseStore.query('DELETE FROM Perf');
  databaseStore.markAsDirty();
  loadPerfRecords();
  computeMissing();
}
</script>

<style scoped>
.records-card {
  width: 100%;
  min-height: calc(100vh - 100px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.records-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #f5f5f5;
  border-radius: 8px;
  flex-wrap: wrap;
}

.progress-box {
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.panels-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.record-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-title {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 84px;
  padding: 12px 16px;
  color: white;
  font-weight: 600;
  font-size: 1rem;
  text-transform: uppercase;
}

.panel-icon {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.3;
  pointer-events: none;
}

.panel-title > span,
.speed-filter {
  position: relative;
  z-index: 1;
}

.record-table td {
  padding-top: 6px !important;
  padding-bottom: 6px !important;
  vertical-align: middle;
}

.speed-filter {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding: 2px 4px 2px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  font: inherit;
  text-transform: none;
  line-height: 1;
  cursor: pointer;
}

.record-row {
  cursor: pointer;
}

.value-cell {
  position: relative;
}

/* Course icon as a watermark behind the flight description */
.row-course-icon {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: #9e9e9e;
  opacity: 0.22;
  pointer-events: none;
}

.value-cell > div {
  position: relative;
}

.rank-cell {
  width: 36px;
  text-align: center;
}

.rank-number {
  font-weight: 600;
  color: #757575;
}

.record-value {
  font-weight: 700;
  font-size: 1rem;
}

.record-extra,
.record-site {
  font-size: 0.8rem;
  color: #757575;
}

.detail-cell {
  text-align: right;
}

.record-date {
  font-size: 0.85rem;
  white-space: nowrap;
}

.panel-empty {
  padding: 24px;
  text-align: center;
  color: #9e9e9e;
}
</style>
