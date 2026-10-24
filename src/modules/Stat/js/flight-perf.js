import IGCParser from 'igc-parser';
import { settings } from '@/js/settings/settingsService';

/**
 * Per-flight performance cache used by the Records page.
 * Max altitude and best scores (free distance, flat triangle, FAI triangle)
 * are expensive to compute, so they are stored once per flight in the Perf table
 * and recomputed only when the track or the scoring league changes.
 */

// Course codes from igc-xc-score scoring rules
export const COURSE_CODES = ['od', 'tri', 'fai'];

// Bump when the stored values change meaning, to recompute all cached rows
const PERF_VERSION = 2;

// Maximum time spent by the solver on one course type of one flight (ms)
const SOLVER_CAP_MS = 8000;
// Duration of each solver slice before yielding to the UI (ms)
const SOLVER_SLICE_MS = 50;

let scoringModule = null;

async function getScoringModule() {
  if (!scoringModule) {
    scoringModule = await import('igc-xc-score');
  }
  return scoringModule;
}

function nextTick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Create the Perf table if needed and remove rows of deleted flights
 * @param {Object} databaseStore
 */
export function ensurePerfTable(databaseStore) {
  databaseStore.query(`CREATE TABLE IF NOT EXISTS Perf (
    P_V_ID INTEGER PRIMARY KEY,
    P_League TEXT,
    P_IgcLen INTEGER,
    P_MaxAlt INTEGER,
    P_OdKm REAL,
    P_OdPts REAL,
    P_TriKm REAL,
    P_TriPts REAL,
    P_FaiKm REAL,
    P_FaiPts REAL
  )`);
  databaseStore.query('DELETE FROM Perf WHERE P_V_ID NOT IN (SELECT V_ID FROM Vol)');
}

/**
 * Scoring league used for the records, from the settings
 * @returns {string} 'FFVL' or 'XContest'
 */
export function getRecordsLeague() {
  return settings.value?.league === 'XContest' ? 'XContest' : 'FFVL';
}

/**
 * Value stored in P_League: scoring league and cache version
 * @param {string} league
 * @returns {string}
 */
export function perfKey(league) {
  return `${league}:${PERF_VERSION}`;
}

/**
 * Ids of flights with a track whose performance is missing or outdated,
 * longest flights first so the records show up early
 * @param {Object} databaseStore
 * @param {string} league
 * @returns {number[]}
 */
export function getFlightsToCompute(databaseStore, league) {
  const req = `SELECT V_ID FROM Vol LEFT JOIN Perf ON P_V_ID = V_ID
    WHERE V_IGC IS NOT NULL AND V_IGC != ''
    AND (P_V_ID IS NULL OR P_League != '${perfKey(league)}' OR P_IgcLen != length(V_IGC))
    ORDER BY V_Duree DESC`;
  const result = databaseStore.query(req);
  if (result.success && result.data && result.data[0]) {
    return result.data[0].values.map(row => row[0]);
  }
  return [];
}

/**
 * Run the solver for one course type, in small slices so the UI stays responsive
 * @returns {{km: number, pts: number}|null}
 */
async function solveCourse(flight, rules, shouldStop) {
  const { solver } = await getScoringModule();
  const it = solver(flight, rules, { noflight: true, maxcycle: SOLVER_SLICE_MS });
  const tStart = Date.now();
  let step = it.next();
  while (!step.done && Date.now() - tStart < SOLVER_CAP_MS && !shouldStop()) {
    await nextTick();
    step = it.next();
  }
  const best = step.value;
  if (!best || !best.score || !best.scoreInfo) return null;
  // Scored distance, after the triangle closing penalty (as shown by XContest)
  const km = best.scoreInfo.distance - (best.scoreInfo.penalty || 0);
  return {
    km: Math.round(km * 100) / 100,
    pts: Math.round(best.score * 100) / 100
  };
}

/**
 * Compute max altitude and best scores of one flight and store them in Perf
 * @param {Object} databaseStore
 * @param {number} flightId
 * @param {string} league
 * @param {Function} shouldStop returns true when the computation must be aborted
 * @returns {boolean} false if aborted
 */
export async function computeFlightPerf(databaseStore, flightId, league, shouldStop) {
  const result = databaseStore.query(`SELECT V_IGC FROM Vol WHERE V_ID = ${flightId}`);
  if (!result.success || !result.data || !result.data[0]) return true;
  let strIgc = result.data[0].values[0][0] || '';
  const igcLen = strIgc.length;
  // Very old Logfly versions could store a leading XON character
  if (strIgc.charAt(0) === '\u0013') strIgc = strIgc.substring(1);

  const perf = { maxAlt: null, od: null, tri: null, fai: null };
  try {
    const flight = IGCParser.parse(strIgc, { lenient: true });
    const fixes = flight.fixes.filter(f => f.valid);
    if (fixes.length > 0) {
      let maxAlt = 0;
      for (const fix of fixes) {
        const alt = fix.gpsAltitude || fix.pressureAltitude || 0;
        if (alt > maxAlt) maxAlt = alt;
      }
      perf.maxAlt = maxAlt > 0 ? Math.round(maxAlt) : null;
    }
    if (fixes.length >= 5) {
      const { scoringRules } = await getScoringModule();
      for (const code of COURSE_CODES) {
        if (shouldStop()) return false;
        const rules = scoringRules[league].filter(r => r.code === code);
        perf[code] = await solveCourse(flight, rules, shouldStop);
      }
    }
  } catch (error) {
    console.log(`[flight-perf] flight ${flightId} not analyzed:`, error.message);
  }
  if (shouldStop()) return false;

  const val = v => (v === null || v === undefined ? 'NULL' : v);
  databaseStore.query(`INSERT OR REPLACE INTO Perf
    (P_V_ID, P_League, P_IgcLen, P_MaxAlt, P_OdKm, P_OdPts, P_TriKm, P_TriPts, P_FaiKm, P_FaiPts)
    VALUES (${flightId}, '${perfKey(league)}', ${igcLen}, ${val(perf.maxAlt)},
    ${val(perf.od?.km)}, ${val(perf.od?.pts)}, ${val(perf.tri?.km)}, ${val(perf.tri?.pts)},
    ${val(perf.fai?.km)}, ${val(perf.fai?.pts)})`);
  return true;
}
