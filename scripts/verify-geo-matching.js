/**
 * Exercises the geo-matching engine in plain Node — no React Native, no bundler, no device.
 *
 * Covers the required test matrix: nearby demo worker, real+demo combined, zero real workers, outside
 * radius, wrong service, offline, on leave, invalid coordinates, and ranking. Uses the SAME module
 * source the app ships (imports are textually shimmed, exactly like verify-local-stores.js) so this
 * cannot pass against a different implementation than the one that runs on the phone.
 *
 * Run: node scripts/verify-geo-matching.js   (or `npm run check:geo`)
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

/** Loads an ES module by stripping imports and injecting shims for what it depends on. */
function loadModule(rel, shims = {}) {
  const raw = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const body = raw
    .replace(/^import[^;]*;$/gm, '')
    .replace(/^export let /gm, 'let ')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export \{[^}]*\};$/gm, '');
  const exported = [...raw.matchAll(/^export (?:let|const|function) (\w+)/gm)].map((m) => m[1]);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(shims), `${body}\nreturn { ${exported.join(', ')} };`);
  return factory(...Object.values(shims));
}

let pass = 0;
let fail = 0;
function chk(label, ok) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

// ---------------------------------------------------------------------------
// distance util (no dependencies of its own)
// ---------------------------------------------------------------------------
const dist = loadModule('src/utils/distance.js');

console.log('=== distance util ===');
{
  // Known reference: Heritage Institute of Technology -> Anandapur, ~1.1 km.
  const d = dist.calculateDistance(22.51653, 88.41821, 22.5119, 88.4110);
  chk('computes a plausible short distance (0.5-2 km)', d > 0.5 && d < 2);
  chk('identical points -> 0 km', dist.calculateDistance(22.5, 88.4, 22.5, 88.4) === 0);
  chk('symmetric', Math.abs(dist.calculateDistance(22.5, 88.4, 22.6, 88.5) - dist.calculateDistance(22.6, 88.5, 22.5, 88.4)) < 1e-9);

  // Every invalid form must yield null, never NaN — a NaN in a comparator scrambles the ranking.
  const bad = [
    ['null lat', dist.calculateDistance(null, 88.4, 22.5, 88.4)],
    ['undefined lng', dist.calculateDistance(22.5, undefined, 22.5, 88.4)],
    ['NaN', dist.calculateDistance(NaN, 88.4, 22.5, 88.4)],
    ['lat > 90', dist.calculateDistance(91, 88.4, 22.5, 88.4)],
    ['lat < -90', dist.calculateDistance(-91, 88.4, 22.5, 88.4)],
    ['lng > 180', dist.calculateDistance(22.5, 181, 22.5, 88.4)],
    ['lng < -180', dist.calculateDistance(22.5, -181, 22.5, 88.4)],
    ['string coords', dist.calculateDistance('22.5', '88.4', 22.5, 88.4)],
    ['Infinity', dist.calculateDistance(Infinity, 88.4, 22.5, 88.4)],
    ['object', dist.calculateDistance({}, 88.4, 22.5, 88.4)],
  ];
  chk('ALL invalid inputs return null (never NaN)', bad.every(([, v]) => v === null));

  chk('isWithinRadius: inside', dist.isWithinRadius(4, 10) === true);
  chk('isWithinRadius: on the boundary is inside', dist.isWithinRadius(10, 10) === true);
  chk('isWithinRadius: outside', dist.isWithinRadius(11, 10) === false);
  chk('isWithinRadius: null distance fails CLOSED', dist.isWithinRadius(null, 10) === false);
  chk('isWithinRadius: NaN fails closed', dist.isWithinRadius(NaN, 10) === false);

  chk('formatDistance sub-km -> metres', dist.formatDistance(0.85) === '850 m');
  chk('formatDistance mid -> one decimal', dist.formatDistance(1.44) === '1.4 km');
  chk('formatDistance far -> whole km', dist.formatDistance(18.3) === '18 km');
  chk('formatDistance null-safe', dist.formatDistance(null) === null);
  chk('DEFAULT_MATCHING_RADIUS_KM is defined once', dist.DEFAULT_MATCHING_RADIUS_KM === 10);
}

// ---------------------------------------------------------------------------
// matching engine, with the real stores shimmed in
// ---------------------------------------------------------------------------
const DEMO_ANCHOR = { lat: 22.51653, lng: 88.41821 };

const DEMO_COORDS = {
  w1: { lat: 22.5119, lng: 88.4110 },
  w2: { lat: 22.5148, lng: 88.3850 },
  w3: { lat: 22.4990, lng: 88.3712 },
  w4: { lat: 22.5375, lng: 88.3690 },
  w5: { lat: 22.6547, lng: 88.4467 },
};

/** Builds the engine with controllable availability/leave/location, so each case is isolated. */
function buildEngine({ workers, availability = {}, leave = {}, locations = DEMO_COORDS }) {
  return loadModule('src/services/geoMatchingService.js', {
    mockWorkers: workers,
    getWorkerAvailability: (id, fallback) => (id in availability ? availability[id] : fallback),
    isOnLeave: (reqs) => {
      if (Array.isArray(reqs) && reqs.__onLeave) return true;
      return !!(reqs && reqs.__onLeave);
    },
    getWorkerLocation: (id) => {
      const c = locations[id];
      return c ? { lat: c.lat, lng: c.lng, isLive: false } : null;
    },
    DEMO_CUSTOMER_ANCHOR: DEMO_ANCHOR,
    toSkillIds: () => [],
    applyStats: (base) => base,
    calculateDistance: dist.calculateDistance,
    isWithinRadius: dist.isWithinRadius,
    isValidLatitude: dist.isValidLatitude,
    isValidLongitude: dist.isValidLongitude,
    DEFAULT_MATCHING_RADIUS_KM: dist.DEFAULT_MATCHING_RADIUS_KM,
  });
}

const DEMO_FIVE = [
  { id: 'w1', name: 'Suresh Kumar', serviceIds: ['plumbing'], available: true, rating: 4.8, fairnessPosition: 1, leaveRequests: [] },
  { id: 'w2', name: 'Ramesh Yadav', serviceIds: ['electrical'], available: true, rating: 4.6, fairnessPosition: 2, leaveRequests: [] },
  { id: 'w3', name: 'Meena Devi', serviceIds: ['cleaning'], available: false, rating: 4.9, fairnessPosition: 3, leaveRequests: { __onLeave: true } },
  { id: 'w4', name: 'Vikram Singh', serviceIds: ['ac-repair', 'appliance-repair'], available: true, rating: 4.5, fairnessPosition: 4, leaveRequests: [] },
  { id: 'w5', name: 'Anita Kumari', serviceIds: ['painting'], available: true, rating: 4.7, fairnessPosition: 5, leaveRequests: [] },
];

console.log('');
console.log('=== TEST 1 - nearby demo worker, ZERO real workers ===');
{
  const eng = buildEngine({ workers: DEMO_FIVE, availability: { w1: true } });
  const r = eng.findNearbyWorkers({ serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng });
  chk('a demo worker is matched with no real workers present', r.workers.length === 1);
  chk('it is w1', r.workers[0]?.workerId === 'w1');
  chk('distance was actually calculated', typeof r.workers[0]?.distanceKm === 'number' && r.workers[0].distanceKm > 0);
  chk('flagged as demo', r.workers[0]?.isDemo === true);
  chk('meta counts demo vs real', r.meta.demoMatched === 1 && r.meta.realMatched === 0);
  console.log(`         -> ${r.workers[0].name} at ${r.workers[0].distanceKm.toFixed(2)} km, score ${r.workers[0].matchScore}`);
}

console.log('');
console.log('=== TEST 2 - real + demo in ONE ranked list ===');
{
  const realWorker = {
    workerId: 'real-1', name: 'Real Plumber', serviceIds: ['plumbing'],
    available: true, rating: 4.2, fairnessPosition: 2, leaveRequests: [],
  };
  const eng = buildEngine({
    workers: DEMO_FIVE,
    availability: { w1: true, 'real-1': true },
    locations: { ...DEMO_COORDS, 'real-1': { lat: 22.5300, lng: 88.4050 } },
  });
  const r = eng.findNearbyWorkers({
    serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng, realWorkers: [realWorker],
  });
  chk('both a real and a demo worker matched', r.workers.length === 2);
  chk('one real, one demo', r.meta.realMatched === 1 && r.meta.demoMatched === 1);
  chk('both carry a distance', r.workers.every((w) => typeof w.distanceKm === 'number'));
  chk('both carry a score', r.workers.every((w) => typeof w.matchScore === 'number'));
  chk('sorted by score descending', r.workers[0].matchScore >= r.workers[1].matchScore);
  r.workers.forEach((w) => console.log(`         -> ${w.isDemo ? 'DEMO' : 'REAL'} ${w.name}: ${w.distanceKm.toFixed(2)} km, score ${w.matchScore}`));
}

console.log('');
console.log('=== TEST 4 - worker OUTSIDE the radius is excluded ===');
{
  const eng = buildEngine({ workers: DEMO_FIVE, availability: { w5: true } });
  const inside = eng.findNearbyWorkers({ serviceId: 'painting', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng, radiusKm: 10 });
  chk('w5 (~18 km) excluded at 10 km', inside.workers.length === 0);
  chk('excluded with reason out-of-radius', inside.excluded.some((e) => e.workerId === 'w5' && e.reason === 'out-of-radius'));

  const wider = eng.findNearbyWorkers({ serviceId: 'painting', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng, radiusKm: 25 });
  chk('same worker INCLUDED at 25 km (radius is configurable)', wider.workers.some((w) => w.workerId === 'w5'));
  console.log(`         -> w5 distance ${wider.workers.find((w) => w.workerId === 'w5').distanceKm.toFixed(2)} km`);
}

console.log('');
console.log('=== TEST 5 - wrong service excluded (proximity is not competence) ===');
{
  const eng = buildEngine({ workers: DEMO_FIVE, availability: { w1: true, w2: true } });
  const r = eng.findNearbyWorkers({ serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng });
  chk('electrician not returned for a plumbing request', !r.workers.some((w) => w.workerId === 'w2'));
  chk('excluded with reason service-mismatch', r.excluded.some((e) => e.workerId === 'w2' && e.reason === 'service-mismatch'));
  chk('the plumber IS returned', r.workers.some((w) => w.workerId === 'w1'));
}

console.log('');
console.log('=== TEST 6 & 7 - offline and on-leave excluded ===');
{
  const eng = buildEngine({ workers: DEMO_FIVE, availability: { w1: false, w3: true } });
  const off = eng.findNearbyWorkers({ serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng });
  chk('OFFLINE worker excluded', !off.workers.some((w) => w.workerId === 'w1'));
  chk('reason is offline', off.excluded.some((e) => e.workerId === 'w1' && e.reason === 'offline'));

  // w3 is forced available, so leave must be the thing that removes her.
  const leave = eng.findNearbyWorkers({ serviceId: 'cleaning', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng });
  chk('ON-LEAVE worker excluded even when available', !leave.workers.some((w) => w.workerId === 'w3'));
  chk('reason is on-leave', leave.excluded.some((e) => e.workerId === 'w3' && e.reason === 'on-leave'));
}

console.log('');
console.log('=== TEST 8 - invalid / missing coordinates never crash ===');
{
  const broken = [
    { id: 'bad1', name: 'No Location', serviceIds: ['plumbing'], available: true, rating: 4, fairnessPosition: 1, leaveRequests: [] },
    { id: 'bad2', name: 'Lat 999', serviceIds: ['plumbing'], available: true, rating: 4, fairnessPosition: 1, leaveRequests: [] },
    { id: 'bad3', name: 'Null Coords', serviceIds: ['plumbing'], available: true, rating: 4, fairnessPosition: 1, leaveRequests: [] },
    { id: 'good', name: 'Fine', serviceIds: ['plumbing'], available: true, rating: 4, fairnessPosition: 1, leaveRequests: [] },
  ];
  const eng = buildEngine({
    workers: broken,
    availability: { bad1: true, bad2: true, bad3: true, good: true },
    locations: {
      bad2: { lat: 999, lng: 88.4 },
      bad3: { lat: null, lng: null },
      good: { lat: 22.5119, lng: 88.4110 },
    },
  });
  let threw = false;
  let r;
  try {
    r = eng.findNearbyWorkers({ serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng });
  } catch (e) {
    threw = true;
  }
  chk('does not throw on malformed worker data', !threw);
  chk('only the well-formed worker is returned', r.workers.length === 1 && r.workers[0].workerId === 'good');
  chk('no NaN distances survive', r.workers.every((w) => Number.isFinite(w.distanceKm)));
  chk('missing coords excluded as no-location', r.excluded.some((e) => e.workerId === 'bad1' && e.reason === 'no-location'));
  chk('out-of-range lat excluded as no-location', r.excluded.some((e) => e.workerId === 'bad2' && e.reason === 'no-location'));
  chk('null coords excluded as no-location', r.excluded.some((e) => e.workerId === 'bad3' && e.reason === 'no-location'));
}

console.log('');
console.log('=== TEST 9 & 10 - no customer coordinates (GPS denied / unavailable) ===');
{
  const eng = buildEngine({ workers: DEMO_FIVE, availability: { w1: true } });
  const cases = [
    ['undefined', {}],
    ['null', { latitude: null, longitude: null }],
    ['NaN', { latitude: NaN, longitude: NaN }],
    ['out of range', { latitude: 999, longitude: 999 }],
  ];
  let allOk = true;
  cases.forEach(([label, coords]) => {
    let r;
    try {
      r = eng.findNearbyWorkers({ serviceId: 'plumbing', ...coords });
    } catch {
      allOk = false;
      return;
    }
    if (!r.meta.usedFallbackOrigin || r.workers.length !== 1) allOk = false;
    console.log(`         -> ${label}: fallback=${r.meta.usedFallbackOrigin}, matched=${r.workers.length}`);
  });
  chk('every missing/invalid origin falls back and still matches', allOk);
}

console.log('');
console.log('=== TEST 14 - multi-worker ranking, distance & fairness beat rating ===');
{
  // Same service. The FAR worker has the BEST rating; a cooperative platform must not let that win.
  const workers = [
    { id: 'near', name: 'Near Lower-Rated', serviceIds: ['plumbing'], available: true, rating: 3.5, fairnessPosition: 1, leaveRequests: [] },
    { id: 'far', name: 'Far Top-Rated', serviceIds: ['plumbing'], available: true, rating: 5.0, fairnessPosition: 8, leaveRequests: [] },
  ];
  const eng = buildEngine({
    workers,
    availability: { near: true, far: true },
    locations: { near: { lat: 22.5155, lng: 88.4170 }, far: { lat: 22.6547, lng: 88.4467 } },
  });
  const r = eng.findNearbyWorkers({ serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng, radiusKm: 25 });
  chk('both matched', r.workers.length === 2);
  chk('NEAR worker outranks the FAR top-rated one', r.workers[0].workerId === 'near');
  chk('distances are strictly ordered', r.workers[0].distanceKm < r.workers[1].distanceKm);
  r.workers.forEach((w) => console.log(`         -> ${w.name}: ${w.distanceKm.toFixed(2)} km, rating ${w.rating}, score ${w.matchScore}`));

  chk('weights sum to 1', Math.abs(Object.values(eng.MATCH_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  chk('distance+fairness (35%) outweigh rating (10%)', eng.MATCH_WEIGHTS.distance + eng.MATCH_WEIGHTS.fairness > eng.MATCH_WEIGHTS.rating);
}

console.log('');
console.log('=== determinism (a demo must not reshuffle between runs) ===');
{
  const eng = buildEngine({ workers: DEMO_FIVE, availability: { w1: true, w4: true, w5: true } });
  const once = eng.findNearbyWorkers({ serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng, radiusKm: 25 });
  const twice = eng.findNearbyWorkers({ serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng, radiusKm: 25 });
  chk('identical input -> identical order', JSON.stringify(once.workers.map((w) => w.workerId)) === JSON.stringify(twice.workers.map((w) => w.workerId)));
  chk('identical input -> identical scores', JSON.stringify(once.workers.map((w) => w.matchScore)) === JSON.stringify(twice.workers.map((w) => w.matchScore)));
}

console.log('');
console.log('=== empty results are honest (no distant workers passed off as nearby) ===');
{
  const eng = buildEngine({ workers: DEMO_FIVE, availability: { w1: true } });
  const none = eng.findNearbyWorkers({ serviceId: 'pest-control', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng });
  chk('no worker for an unserved category', none.workers.length === 0);
  chk('but diagnostics explain why', none.excluded.length > 0);

  const tiny = eng.findNearbyWorkers({ serviceId: 'plumbing', latitude: DEMO_ANCHOR.lat, longitude: DEMO_ANCHOR.lng, radiusKm: 0.1 });
  chk('a 100 m radius returns nobody rather than the nearest anyway', tiny.workers.length === 0);
}

console.log('');
console.log(fail === 0 ? `ALL GEO-MATCHING CHECKS PASSED (${pass})` : `${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
