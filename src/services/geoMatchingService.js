import { mockWorkers } from '@data/mockWorkers';
import { getWorkerAvailability, isOnLeave } from '@data/workerStatus';
import { getWorkerLocation, DEMO_CUSTOMER_ANCHOR } from '@data/workerLocations';
import { toSkillIds } from '@data/workerRegistration';
import { applyStats } from '@data/workerStats';
import {
  calculateDistance,
  isWithinRadius,
  isValidLatitude,
  isValidLongitude,
  DEFAULT_MATCHING_RADIUS_KM,
} from '@utils/distance';

/**
 * Geo-matching engine — "which workers suit this request, and in what order?"
 *
 * DELIBERATELY UI-FREE. It takes a service id and a coordinate, returns ranked plain objects, and
 * imports nothing from React or any screen. That keeps it unit-testable in plain Node (see
 * scripts/verify-geo-matching.js) and stops matching logic leaking into render paths.
 *
 * ONE PIPELINE FOR REAL AND DEMO WORKERS. Both sources are normalised to the same shape FIRST, then
 * put through identical service / availability / leave / distance / radius / score / sort stages.
 * There is no demo bypass and no "if nothing found, show demo workers anyway" branch — a demo worker
 * appears only because it genuinely satisfied every filter. That is what makes the demo an honest
 * demonstration of the algorithm rather than a mock-up of one.
 *
 * SEPARATE FROM LIVE TRACKING. This answers "who should do this job?". Tracking answers "where is
 * the worker we already chose?". They share only the distance utility.
 *
 * NO PostGIS, NO server-side query. Worker counts here are tens, not millions; filtering in JS over
 * an already-loaded list costs nothing, needs no migration, works with Supabase unreachable, and
 * keeps the free plan untouched. The seam is `loadWorkerCandidates`, so a future
 * `rpc('workers_near', ...)` can replace the source without touching the scoring.
 */

/** Scoring weights. Sum to 1. Exported so tests and any tuning UI read the same numbers. */
export const MATCH_WEIGHTS = {
  service: 0.4,
  distance: 0.25,
  availability: 0.15,
  fairness: 0.1,
  rating: 0.1,
};

/**
 * Fairness contribution used when the platform has no real fairness signal for a worker.
 *
 * NEUTRAL (0.5) ON PURPOSE. Inventing a flattering fairness number would be fabricating data, and
 * scoring an unknown as 0 would permanently bury every worker the app has no history for — which on
 * a cooperative platform is precisely the newest and most vulnerable members. A neutral value keeps
 * them competitive on the signals that ARE real (service, distance, availability).
 */
export const NEUTRAL_FAIRNESS = 0.5;

/** Reasons a candidate was excluded. Returned in diagnostics so a UI can explain an empty result. */
export const EXCLUSION = {
  SERVICE: 'service-mismatch',
  OFFLINE: 'offline',
  ON_LEAVE: 'on-leave',
  NO_LOCATION: 'no-location',
  OUT_OF_RADIUS: 'out-of-radius',
  BANNED: 'banned',
};

/**
 * Resolves a worker's service ids from whatever their record actually holds.
 *
 * NECESSARY BECAUSE THE TWO SOURCES DISAGREE. Registered workers store service ids
 * (`['plumbing']`); the seeded demo workers store display names (`['Plumbing','Pipe Fitting']`), and
 * some of those names — 'Pipe Fitting', 'Deep Cleaning' — match no catalogue entry at all.
 * `toSkillIds` resolves what it can and drops the rest.
 *
 * The `serviceIds` fallback path exists for a real subtlety: mockWorkers w3 carries
 * 'House Cleaning', which does not equal the catalogue's 'Cleaning', so she would otherwise resolve
 * to zero services and be permanently unmatchable. Rather than rewrite the seed data (which other
 * screens display verbatim), an explicit `serviceIds` override is honoured when present.
 */
function resolveServiceIds(worker) {
  if (Array.isArray(worker.serviceIds) && worker.serviceIds.length) return worker.serviceIds;
  if (Array.isArray(worker.skillIds) && worker.skillIds.length) return worker.skillIds;
  return toSkillIds(worker.skills || []);
}

/**
 * Normalises one seeded demo worker into the common candidate model.
 *
 * Availability comes from the SHARED workerStatus store (not the seed's `available` flag), so a
 * toggle the worker flipped in their own portal is what matching sees — exactly what the admin list
 * already does. Leave comes from the SHARED isOnLeave derivation. Neither is reimplemented here.
 */
function normaliseDemoWorker(worker) {
  const location = getWorkerLocation(worker.id);
  // Layer completed-job deltas over the seeded baseline so rating/jobs reflect real activity.
  const stats = applyStats(
    { totalJobs: worker.totalJobs ?? 0, earnings: worker.earnings ?? 0, rating: worker.rating ?? null },
    worker.id,
  );

  return {
    workerId: worker.id,
    name: worker.name || '—',
    phone: worker.phone || null,
    cooperative: worker.cooperative || null,
    serviceIds: resolveServiceIds(worker),
    latitude: location?.lat ?? null,
    longitude: location?.lng ?? null,
    locationIsLive: !!location?.isLive,
    available: getWorkerAvailability(worker.id, worker.available ?? false),
    onLeave: isOnLeave(worker.leaveRequests),
    banned: !!worker.banned,
    rating: typeof stats.rating === 'number' ? stats.rating : null,
    totalJobs: stats.totalJobs ?? 0,
    fairnessPosition: worker.fairnessPosition ?? null,
    isDemo: true,
  };
}

/**
 * Normalises a real (registered/Supabase) worker into the SAME model.
 *
 * Kept separate from the demo normaliser only because the input shapes differ — everything
 * downstream treats the outputs identically, and `isDemo` is the sole distinguishing field.
 */
function normaliseRealWorker(worker) {
  const id = worker.workerId || worker.id;
  const location = getWorkerLocation(id);
  return {
    workerId: id,
    name: worker.name || worker.full_name || '—',
    phone: worker.phone || null,
    cooperative: worker.cooperative || null,
    serviceIds: resolveServiceIds(worker),
    latitude: location?.lat ?? null,
    longitude: location?.lng ?? null,
    locationIsLive: !!location?.isLive,
    available: getWorkerAvailability(id, worker.available ?? false),
    onLeave: isOnLeave(worker.leaveRequests || []),
    banned: !!worker.banned,
    rating: typeof worker.rating === 'number' ? worker.rating : null,
    totalJobs: worker.totalJobs ?? 0,
    fairnessPosition: worker.fairnessPosition ?? null,
    isDemo: false,
  };
}

/**
 * Assembles the candidate pool: seeded demo workers + any real workers handed in.
 *
 * Real workers are INJECTED rather than fetched. This service must stay synchronous and offline-safe,
 * and the only cross-user worker query in the app (`getWorkerList`) is admin-scoped and rejected by
 * RLS for a demo session. A caller that does have real workers passes them; a caller that does not
 * still gets a working demo pool. De-duplicated by workerId, with real records winning, so a worker
 * present in both sources is not matched twice.
 */
export function loadWorkerCandidates({ realWorkers = [] } = {}) {
  const out = [];
  const seen = new Set();

  (realWorkers || []).forEach((w) => {
    const norm = normaliseRealWorker(w);
    if (!norm.workerId || seen.has(norm.workerId)) return;
    seen.add(norm.workerId);
    out.push(norm);
  });

  (mockWorkers || []).forEach((w) => {
    if (seen.has(w.id)) return;
    seen.add(w.id);
    out.push(normaliseDemoWorker(w));
  });

  return out;
}

/** Sub-score 0..1 for distance: linear decay across the radius, nearest = 1. */
function distanceScore(distanceKm, radiusKm) {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) return 0;
  if (radiusKm <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - distanceKm / radiusKm));
}

/**
 * Sub-score 0..1 for fairness, derived from the EXISTING fairnessPosition (1 = front of queue).
 *
 * Reuses the fairness concept the app already ships rather than inventing a second one. Workers with
 * no position get NEUTRAL_FAIRNESS — see the constant for why that is not zero.
 */
function fairnessScore(fairnessPosition) {
  if (typeof fairnessPosition !== 'number' || !Number.isFinite(fairnessPosition) || fairnessPosition < 1) {
    return NEUTRAL_FAIRNESS;
  }
  // Positions 1..10 map onto 1.0..0.1; beyond that the contribution flattens out.
  return Math.max(0.1, Math.min(1, 1 / fairnessPosition));
}

/** Sub-score 0..1 for rating. Unrated workers score neutrally, never zero. */
function ratingScore(rating) {
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating <= 0) return NEUTRAL_FAIRNESS;
  return Math.max(0, Math.min(1, rating / 5));
}

/**
 * Weighted match score, 0..100.
 *
 * Every candidate reaching this point has already passed the service, availability, leave and radius
 * filters, so `service` and `availability` are full marks — they are retained in the formula so the
 * weights stay auditable against the specification, and so a future "partial skill match" can slot
 * in without reshaping the scoring.
 *
 * The important property: distance and fairness together (35%) outweigh rating (10%), so the
 * highest-rated worker does NOT automatically win. On a cooperative platform, a nearby worker near
 * the front of the fairness queue should beat a distant favourite.
 */
export function computeMatchScore({ distanceKm, radiusKm, fairnessPosition, rating }) {
  const score =
    MATCH_WEIGHTS.service * 1 +
    MATCH_WEIGHTS.distance * distanceScore(distanceKm, radiusKm) +
    MATCH_WEIGHTS.availability * 1 +
    MATCH_WEIGHTS.fairness * fairnessScore(fairnessPosition) +
    MATCH_WEIGHTS.rating * ratingScore(rating);
  return Math.round(score * 1000) / 10; // one decimal place, 0..100
}

/**
 * Finds and ranks workers who can serve a request at a given point.
 *
 * Returns `{ workers, excluded, meta }`. `excluded` carries a reason per rejected candidate so the UI
 * can say something useful ("3 nearby, but on leave") instead of a bare empty state, and so tests can
 * assert WHY something was filtered rather than merely that the list shrank.
 *
 * A missing/invalid customer coordinate is not an error: it falls back to DEMO_CUSTOMER_ANCHOR (the
 * demo service address, which is also where live tracking terminates) and flags
 * `meta.usedFallbackOrigin`. That is what keeps the flow working when GPS is denied or unavailable.
 */
export function findNearbyWorkers({
  serviceId,
  latitude,
  longitude,
  radiusKm = DEFAULT_MATCHING_RADIUS_KM,
  realWorkers = [],
  limit = 20,
} = {}) {
  const effectiveRadius =
    typeof radiusKm === 'number' && Number.isFinite(radiusKm) && radiusKm > 0
      ? radiusKm
      : DEFAULT_MATCHING_RADIUS_KM;

  const originValid = isValidLatitude(latitude) && isValidLongitude(longitude);
  const origin = originValid
    ? { lat: latitude, lng: longitude }
    : { lat: DEMO_CUSTOMER_ANCHOR.lat, lng: DEMO_CUSTOMER_ANCHOR.lng };

  const candidates = loadWorkerCandidates({ realWorkers });
  const workers = [];
  const excluded = [];

  candidates.forEach((c) => {
    const reject = (reason) => excluded.push({ workerId: c.workerId, name: c.name, isDemo: c.isDemo, reason });

    if (c.banned) return reject(EXCLUSION.BANNED);

    // SERVICE COMPATIBILITY. Proximity never substitutes for competence: a nearby electrician is not
    // a match for a plumbing request. A request with no serviceId matches on everything else.
    if (serviceId && !c.serviceIds.includes(serviceId)) return reject(EXCLUSION.SERVICE);

    if (!c.available) return reject(EXCLUSION.OFFLINE);
    if (c.onLeave) return reject(EXCLUSION.ON_LEAVE);

    if (!isValidLatitude(c.latitude) || !isValidLongitude(c.longitude)) {
      // Never guessed at. An unlocatable worker is excluded from GEO-RANKED results rather than
      // being given a fabricated position that would rank them somewhere arbitrary.
      return reject(EXCLUSION.NO_LOCATION);
    }

    const distanceKm = calculateDistance(origin.lat, origin.lng, c.latitude, c.longitude);
    if (distanceKm === null) return reject(EXCLUSION.NO_LOCATION);
    if (!isWithinRadius(distanceKm, effectiveRadius)) return reject(EXCLUSION.OUT_OF_RADIUS);

    workers.push({
      ...c,
      distanceKm,
      matchScore: computeMatchScore({
        distanceKm,
        radiusKm: effectiveRadius,
        fairnessPosition: c.fairnessPosition,
        rating: c.rating,
      }),
    });
  });

  // Highest score first; distance breaks ties so the ordering is fully deterministic (important for
  // reproducible demos and stable tests), then workerId as a final tiebreak.
  workers.sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    return String(a.workerId).localeCompare(String(b.workerId));
  });

  return {
    workers: workers.slice(0, limit),
    excluded,
    meta: {
      serviceId: serviceId || null,
      radiusKm: effectiveRadius,
      origin,
      usedFallbackOrigin: !originValid,
      totalCandidates: candidates.length,
      matched: workers.length,
      demoMatched: workers.filter((w) => w.isDemo).length,
      realMatched: workers.filter((w) => !w.isDemo).length,
    },
  };
}

/**
 * Distance from a point to ONE worker, or null.
 *
 * Used by the job feed, where the question is inverted — the worker is known and each job's location
 * varies — so the full ranking pipeline would be wasted work.
 */
export function distanceToWorker(workerId, { latitude, longitude }) {
  const loc = getWorkerLocation(workerId);
  if (!loc) return null;
  return calculateDistance(latitude, longitude, loc.lat, loc.lng);
}
