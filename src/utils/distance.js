/**
 * Geographic distance — the ONE place a distance formula lives in this app.
 *
 * WHY THIS FILE EXISTS: a working Haversine already existed as a private function inside
 * LiveTrackingMapScreen (`haversineMeters`), used to compute the worker's remaining distance and
 * ETA. Adding geo-matching needed the same maths in the matching engine, the job feed and the
 * booking wizard. Rather than copy the formula into a second place — where the two could drift, or
 * one could be "fixed" without the other — it is extracted here and that screen now imports it.
 *
 * EVERY FUNCTION IS TOTAL: no input can make these throw. Coordinates arrive from GPS hardware,
 * from user-editable records and from a Supabase column that may be null, so a malformed pair is a
 * normal runtime case rather than an exceptional one. Invalid input yields `null` (an honest "not
 * computable"), never NaN and never a wrong number. A NaN leaking into a sort comparator silently
 * scrambles the ranking, which is far worse than a missing distance.
 *
 * NO PostGIS, NO geospatial extension. Haversine over plain latitude/longitude is accurate to well
 * under a percent at city scale, costs nothing, needs no schema change and runs offline — which is
 * what this project needs. The API is shaped so a PostGIS/`earthdistance` backend could replace the
 * implementation later without touching callers.
 */

/** Mean Earth radius (km), IUGG. Metres are derived from this so the two can never disagree. */
const EARTH_RADIUS_KM = 6371;

/**
 * Default matching radius, in kilometres.
 *
 * Deliberately defined ONCE. Callers accept a radius parameter and fall back to this, so the
 * operating radius can be changed (5 / 10 / 15 km) in one place without touching the algorithm.
 */
export const DEFAULT_MATCHING_RADIUS_KM = 10;

/** Radii offered in the UI. Ordered, so a "widen search" affordance can just step forward. */
export const RADIUS_OPTIONS_KM = [5, 10, 15, 25];

/**
 * True only for a finite number inside the valid range for its axis.
 *
 * Rejects NaN, Infinity, null, undefined, booleans, and numeric strings. Strings are refused on
 * purpose: `'22.5'` silently coercing to a number is how a bad record becomes an invisible bug, so
 * callers must convert explicitly and deal with failure.
 */
export function isValidLatitude(lat) {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng) {
  return typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

/**
 * True when a value is a usable coordinate pair.
 *
 * Accepts the two shapes this codebase already uses — `{ lat, lng }` (mockRoutes, the tracking
 * route) and `{ latitude, longitude }` (react-native-maps, GPS results) — so neither side has to
 * translate before validating.
 */
export function isValidCoordinate(point) {
  if (!point || typeof point !== 'object') return false;
  const lat = point.lat ?? point.latitude;
  const lng = point.lng ?? point.longitude;
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/** Normalises either accepted shape to `{ lat, lng }`, or null when unusable. */
export function toLatLng(point) {
  if (!isValidCoordinate(point)) return null;
  return {
    lat: point.lat ?? point.latitude,
    lng: point.lng ?? point.longitude,
  };
}

/**
 * Great-circle distance in METRES between two coordinate pairs.
 *
 * Returns `null` — never NaN — if any coordinate is missing or out of range.
 */
export function distanceMeters(lat1, lon1, lat2, lon2) {
  if (!isValidLatitude(lat1) || !isValidLongitude(lon1)) return null;
  if (!isValidLatitude(lat2) || !isValidLongitude(lon2)) return null;

  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lon2 - lon1);
  const a = toRad(lat1);
  const b = toRad(lat2);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a) * Math.cos(b) * Math.sin(dLng / 2) ** 2;
  // Clamp guards against a floating-point h a hair above 1 for antipodal points, which would make
  // Math.asin return NaN and defeat the whole point of the validation above.
  return 2 * (EARTH_RADIUS_KM * 1000) * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/**
 * Great-circle distance in KILOMETRES — the primary entry point for matching.
 *
 * Returns `null` for any invalid input. Callers must treat null as "distance unknown" and decide
 * explicitly what that means; it must never be coerced to 0, which would rank an unlocatable worker
 * as the closest one.
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const meters = distanceMeters(lat1, lon1, lat2, lon2);
  return meters === null ? null : meters / 1000;
}

/** Convenience wrapper for two coordinate OBJECTS of either accepted shape. Null-safe. */
export function distanceBetween(a, b) {
  const p = toLatLng(a);
  const q = toLatLng(b);
  if (!p || !q) return null;
  return calculateDistance(p.lat, p.lng, q.lat, q.lng);
}

/**
 * True when `distanceKm` falls inside `radiusKm`.
 *
 * An unknown distance (null) is NOT within radius. Failing closed matters here: treating "we could
 * not locate this worker" as "nearby" is exactly how a distant or unlocatable worker ends up
 * presented to a customer as local.
 */
export function isWithinRadius(distanceKm, radiusKm = DEFAULT_MATCHING_RADIUS_KM) {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm)) return false;
  if (typeof radiusKm !== 'number' || !Number.isFinite(radiusKm) || radiusKm <= 0) return false;
  return distanceKm <= radiusKm;
}

/**
 * Human-readable distance for the UI — "850 m", "1.4 km", "12 km".
 *
 * Deliberately coarse. Precise coordinates are never shown to users (a customer's exact position is
 * private, and so is a worker's); an approximate distance is all either side needs to make a
 * decision. Returns null when the distance is unknown so callers can omit the row rather than
 * printing a misleading "0 km".
 */
export function formatDistance(distanceKm) {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm < 0) return null;
  if (distanceKm < 1) return `${Math.round(distanceKm * 1000)} m`;
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm)} km`;
}
