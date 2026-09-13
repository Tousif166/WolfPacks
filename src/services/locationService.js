import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { isValidLatitude, isValidLongitude } from '@utils/distance';

/**
 * Device location — the single place GPS is touched.
 *
 * WHY A SERVICE: three separate places need a position (the customer's booking wizard, the worker
 * going online, the job feed's distance column). Putting `getCurrentPosition` in each would mean
 * three permission dialogs, three sets of error handling, and three chances to forget a failure
 * case. Screens call this and get a plain result object back.
 *
 * NEVER THROWS, NEVER REJECTS. Every function resolves with a discriminated result:
 *
 *     { ok: true,  coords: { lat, lng, accuracy, timestamp } }
 *     { ok: false, reason: <REASON>, message }
 *
 * A rejected promise here would have to be caught correctly at every call site or it becomes an
 * unhandled rejection and, in release, a crash. Location failure is entirely routine — permission
 * refused, GPS switched off, indoors with no fix — so it is modelled as data, not as an exception.
 * Callers branch on `ok` and fall back; nothing is allowed to take the app down.
 *
 * PERMISSION IS REQUESTED AT THE POINT OF USE, never at launch. A cooperative app asking for GPS on
 * first open, before the user has done anything, reads as surveillance and gets denied — after which
 * the OS will not ask again. Asking when the user has just tapped "use my current location" makes
 * the reason self-evident.
 */

/** Discriminated failure reasons. Callers switch on these rather than parsing messages. */
export const LOCATION_ERRORS = {
  PERMISSION_DENIED: 'permission-denied',
  PERMISSION_BLOCKED: 'permission-blocked',
  POSITION_UNAVAILABLE: 'position-unavailable',
  TIMEOUT: 'timeout',
  INVALID_COORDS: 'invalid-coords',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown',
};

/** Translation keys per reason, so screens show localised copy without a mapping of their own. */
export const LOCATION_ERROR_KEYS = {
  [LOCATION_ERRORS.PERMISSION_DENIED]: 'loc_denied_desc',
  [LOCATION_ERRORS.PERMISSION_BLOCKED]: 'loc_blocked_desc',
  [LOCATION_ERRORS.POSITION_UNAVAILABLE]: 'loc_unavailable_desc',
  [LOCATION_ERRORS.TIMEOUT]: 'loc_timeout_desc',
  [LOCATION_ERRORS.INVALID_COORDS]: 'loc_unavailable_desc',
  [LOCATION_ERRORS.UNSUPPORTED]: 'loc_unavailable_desc',
  [LOCATION_ERRORS.UNKNOWN]: 'loc_unavailable_desc',
};

const fail = (reason, message) => ({ ok: false, reason, message: message || reason });
const succeed = (coords) => ({ ok: true, coords });

let configured = false;

/**
 * Applies library config once.
 *
 * `authorizationLevel: 'whenInUse'` and `enableBackgroundLocationUpdates: false` are set explicitly
 * so the library cannot ask for background location on our behalf — we never want it (see the
 * manifest note). Guarded because calling configure repeatedly is wasteful and, on some versions,
 * resets an in-flight watch.
 */
function ensureConfigured() {
  if (configured) return;
  try {
    Geolocation.setRNConfiguration({
      skipPermissionRequests: true, // we drive PermissionsAndroid ourselves, for clearer UX
      authorizationLevel: 'whenInUse',
      enableBackgroundLocationUpdates: false,
      locationProvider: 'auto',
    });
  } catch (e) {
    // Non-fatal: the defaults are acceptable. Never let configuration stop a location attempt.
    console.warn('locationService: setRNConfiguration failed', e?.message);
  }
  configured = true;
}

/**
 * Requests foreground location permission.
 *
 * Returns `{ ok: true }`, or a failure distinguishing DENIED (asked again later) from BLOCKED
 * ("never ask again" — the OS will not show the dialog, so the UI must point at Settings instead of
 * uselessly re-prompting).
 */
export async function requestLocationPermission() {
  if (Platform.OS !== 'android') {
    // iOS permission is handled by the library on first request; treat as grantable.
    return { ok: true };
  }
  try {
    const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
    const already = await PermissionsAndroid.check(fine);
    if (already) return { ok: true };

    const result = await PermissionsAndroid.request(fine, {
      title: 'Location permission',
      message: 'Sahakar Seva uses your location to find nearby workers and jobs.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    });

    if (result === PermissionsAndroid.RESULTS.GRANTED) return { ok: true };
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
      return fail(LOCATION_ERRORS.PERMISSION_BLOCKED, 'Permission permanently denied');
    }
    return fail(LOCATION_ERRORS.PERMISSION_DENIED, 'Permission denied');
  } catch (e) {
    // A throwing permission check must not read as "granted".
    return fail(LOCATION_ERRORS.UNKNOWN, e?.message);
  }
}

/** True if permission is already held, without prompting. Used to decide whether to even try. */
export async function hasLocationPermission() {
  if (Platform.OS !== 'android') return true;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  } catch {
    return false;
  }
}

/** Maps the platform position error code onto our reasons. */
function mapPositionError(error) {
  // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT (W3C geolocation codes)
  switch (error?.code) {
    case 1:
      return fail(LOCATION_ERRORS.PERMISSION_DENIED, error?.message);
    case 2:
      return fail(LOCATION_ERRORS.POSITION_UNAVAILABLE, error?.message);
    case 3:
      return fail(LOCATION_ERRORS.TIMEOUT, error?.message);
    default:
      return fail(LOCATION_ERRORS.UNKNOWN, error?.message);
  }
}

/** Validates a raw platform position before it reaches matching. */
function readPosition(position) {
  const lat = position?.coords?.latitude;
  const lng = position?.coords?.longitude;
  if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
    return fail(LOCATION_ERRORS.INVALID_COORDS, 'Device returned invalid coordinates');
  }
  return succeed({
    lat,
    lng,
    accuracy: typeof position.coords.accuracy === 'number' ? position.coords.accuracy : null,
    timestamp: position.timestamp || Date.now(),
  });
}

/**
 * One-shot current position.
 *
 * `requestPermission: false` skips the prompt so a caller can check silently; the default asks.
 *
 * Note the deliberately generous timeout and `enableHighAccuracy: false` default: a first GPS fix
 * indoors can take a long time, and for a 10 km matching radius network/coarse location is entirely
 * good enough. Demanding high accuracy here would trade a usable answer for a timeout.
 */
export async function getCurrentLocation({
  requestPermission = true,
  timeout = 15000,
  maximumAge = 60000,
  enableHighAccuracy = false,
} = {}) {
  ensureConfigured();

  if (requestPermission) {
    const perm = await requestLocationPermission();
    if (!perm.ok) return perm;
  } else if (!(await hasLocationPermission())) {
    return fail(LOCATION_ERRORS.PERMISSION_DENIED, 'Permission not granted');
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    // Belt-and-braces timer. Some Android location providers never invoke either callback (notably
    // with GPS hardware disabled), which would otherwise leave this promise pending for ever and
    // hang whatever awaited it.
    const guard = setTimeout(
      () => finish(fail(LOCATION_ERRORS.TIMEOUT, 'Location request timed out')),
      timeout + 2000,
    );

    try {
      Geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(guard);
          finish(readPosition(position));
        },
        (error) => {
          clearTimeout(guard);
          finish(mapPositionError(error));
        },
        { enableHighAccuracy, timeout, maximumAge },
      );
    } catch (e) {
      clearTimeout(guard);
      finish(fail(LOCATION_ERRORS.UNSUPPORTED, e?.message));
    }
  });
}

/**
 * Starts a location watch, returning a subscription id (or null on failure).
 *
 * `onUpdate` receives validated `{ lat, lng, accuracy, timestamp }`; invalid fixes are dropped
 * rather than forwarded. `distanceFilter` means the OS only reports meaningful movement, which is the
 * cheapest way to avoid a flood of updates — combined with the write throttle in workerLocations.js,
 * a moving worker costs a couple of dozen local writes per shift.
 *
 * Callers MUST pair this with stopLocationWatch. Nothing here starts on its own.
 */
export async function watchLocation(onUpdate, onError, { distanceFilter = 100, interval = 45000, enableHighAccuracy = false } = {}) {
  ensureConfigured();

  const perm = await requestLocationPermission();
  if (!perm.ok) {
    if (typeof onError === 'function') onError(perm);
    return null;
  }

  try {
    return Geolocation.watchPosition(
      (position) => {
        const result = readPosition(position);
        if (result.ok && typeof onUpdate === 'function') onUpdate(result.coords);
      },
      (error) => {
        if (typeof onError === 'function') onError(mapPositionError(error));
      },
      { enableHighAccuracy, distanceFilter, interval, fastestInterval: interval },
    );
  } catch (e) {
    if (typeof onError === 'function') onError(fail(LOCATION_ERRORS.UNSUPPORTED, e?.message));
    return null;
  }
}

/** Stops a watch. Safe to call with null/stale ids, so cleanup paths need no guards. */
export function stopLocationWatch(watchId) {
  if (watchId === null || watchId === undefined) return;
  try {
    Geolocation.clearWatch(watchId);
  } catch (e) {
    console.warn('locationService: clearWatch failed', e?.message);
  }
}

/** Stops every watch. Used on logout, where individual ids may no longer be tracked. */
export function stopAllLocationWatches() {
  try {
    Geolocation.stopObserving();
  } catch {
    /* nothing to stop */
  }
}
