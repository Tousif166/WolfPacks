import { useSyncExternalStore } from 'react';
import { getJSON, setJSON } from '@storage/mmkv';
import { isValidLatitude, isValidLongitude } from '@utils/distance';

/**
 * Worker coordinates — where each worker currently is, for geo-matching.
 *
 * WHY LOCAL (MMKV) AND NOT SUPABASE:
 * Every other piece of live worker state in this app already lives in MMKV for the same reason —
 * `worker_profiles` has no latitude/longitude columns, and adding them means a schema migration on a
 * database this code cannot reach. Following the established pattern (workerStatus.js,
 * workerStats.js, workerRegistration.js) also keeps the Supabase free plan untouched: a worker going
 * online writes one local record instead of a row update, and no GPS write ever hits the network.
 *
 * The stored shape is deliberately the one a `worker_profiles.latitude/longitude/location_updated_at`
 * migration would produce, so moving this to Postgres later is a change of source, not of schema.
 *
 * KEYED BY WORKER ID (not email, unlike workerRegistration) because that is what the matching engine
 * and the booking record both carry — `mockWorkers.id` ('w1') for a seeded worker, the Supabase user
 * id for a real one. Availability in workerStatus.js is keyed the same way, so the two line up.
 */

const STORAGE_KEY = 'sahakar_worker_locations';

/**
 * THE DEMO ANCHOR — Heritage Institute of Technology, Chowbaga Road, Kolkata.
 *
 * Not an arbitrary point: it is the coordinate the live-tracking route already terminates at, and it
 * matches DEFAULT_ADDRESS in mockBookings. Using it as the customer's fallback position means the
 * matching demo and the tracking demo describe the same place, and a booking made without GPS still
 * produces sensible distances.
 */
export const DEMO_CUSTOMER_ANCHOR = { lat: 22.51653, lng: 88.41821 };

/**
 * FIXED coordinates for the seeded demo workers.
 *
 * DETERMINISTIC ON PURPOSE. These are hardcoded rather than generated so the demo is reproducible:
 * the same worker is the same distance away on every launch, on every device, in every run of the
 * test suite. Randomising at startup would make the ranking change between rehearsal and
 * presentation, and would make the radius filter impossible to assert in a test.
 *
 * The spread is chosen so the radius filter is VISIBLY doing something against the 10 km default —
 * four workers inside, one deliberately outside. Distances below are the ACTUAL Haversine results
 * from the demo anchor, verified by scripts/verify-geo-matching.js (an earlier draft of this table
 * claimed ~18 km for w5 when the coordinate was really 6.7 km away, which the radius test caught):
 *
 *   w1  Suresh Kumar    0.9 km   Anandapur Road        (inside)
 *   w2  Ramesh Yadav    3.4 km   Kasba Golpark         (inside)
 *   w3  Meena Devi      5.2 km   Jadavpur              (inside, but OFFLINE + on approved leave)
 *   w4  Vikram Singh    5.6 km   Park Circus           (inside)
 *   w5  Anita Kumari   15.6 km   Dum Dum / airport     (OUTSIDE the 10 km default)
 *
 * All are real locations around Kolkata, so the map renders plausibly. w3 sitting inside the radius
 * while still being excluded (offline + on leave) is deliberate: it demonstrates that the eligibility
 * filters are doing work independently of geography.
 */
export const DEMO_WORKER_COORDS = {
  w1: { lat: 22.5119, lng: 88.4110 },
  w2: { lat: 22.5148, lng: 88.3850 },
  w3: { lat: 22.4990, lng: 88.3712 },
  w4: { lat: 22.5375, lng: 88.3690 },
  w5: { lat: 22.6547, lng: 88.4467 },
};

function load() {
  try {
    const parsed = getJSON(STORAGE_KEY);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.error('Error loading worker locations:', e);
  }
  return {};
}

// Replaced (never mutated) on write so useSyncExternalStore sees a new reference and re-renders.
let locations = load();
const listeners = new Set();

function persist() {
  try {
    setJSON(STORAGE_KEY, locations);
  } catch (e) {
    console.error('Error saving worker locations:', e);
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeWorkerLocations(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkerLocationsSnapshot() {
  return locations;
}

/**
 * Minimum gap between persisted location writes for one worker, in milliseconds.
 *
 * The brief is explicit that this must not write on every GPS tick. 45s sits inside the suggested
 * 30–60s window: frequent enough that a worker moving across the city stays roughly current, rare
 * enough that a whole shift is a couple of dozen local writes. `setWorkerLocation` enforces it, so
 * the throttle cannot be forgotten by a caller.
 */
export const MIN_LOCATION_WRITE_INTERVAL_MS = 45000;

/**
 * Records a worker's position.
 *
 * Silently ignores invalid coordinates — GPS genuinely does return nonsense occasionally, and a bad
 * fix must not overwrite a good one. Returns the stored record, or null if nothing was written.
 *
 * `force` bypasses the throttle for events where freshness matters more than write count: going
 * online, and a movement large enough that the old position is misleading.
 */
export function setWorkerLocation(workerId, coords, { force = false } = {}) {
  if (!workerId || typeof workerId !== 'string') return null;
  const lat = coords?.lat ?? coords?.latitude;
  const lng = coords?.lng ?? coords?.longitude;
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) return null;

  const now = Date.now();
  const existing = locations[workerId];
  if (!force && existing?.updatedAt && now - existing.updatedAt < MIN_LOCATION_WRITE_INTERVAL_MS) {
    return existing;
  }

  const record = { lat, lng, updatedAt: now, source: coords?.source || 'gps' };
  locations = { ...locations, [workerId]: record };
  persist();
  emit();
  return record;
}

/** Drops a worker's position — called when they go offline so they stop being geo-matchable. */
export function clearWorkerLocation(workerId) {
  if (!workerId || !locations[workerId]) return;
  const next = { ...locations };
  delete next[workerId];
  locations = next;
  persist();
  emit();
}

/**
 * A worker's best-known coordinate, or null.
 *
 * PRECEDENCE: a live GPS fix wins over the seeded demo coordinate, so a demo worker who actually
 * goes online with location permission reports where they really are rather than their scripted
 * position. The seeded value is the fallback that makes the demo work with zero real workers.
 */
export function getWorkerLocation(workerId) {
  if (!workerId) return null;
  const live = locations[workerId];
  if (live && isValidLatitude(live.lat) && isValidLongitude(live.lng)) {
    return { lat: live.lat, lng: live.lng, updatedAt: live.updatedAt, isLive: true };
  }
  const seeded = DEMO_WORKER_COORDS[workerId];
  if (seeded) return { lat: seeded.lat, lng: seeded.lng, updatedAt: null, isLive: false };
  return null;
}

/** True when this worker can take part in geo-ranked matching at all. */
export function hasUsableLocation(workerId) {
  return getWorkerLocation(workerId) !== null;
}

/** Live worker locations, re-rendering on any change. */
export function useWorkerLocations() {
  return useSyncExternalStore(subscribeWorkerLocations, getWorkerLocationsSnapshot, getWorkerLocationsSnapshot);
}
