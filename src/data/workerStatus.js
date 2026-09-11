import { useSyncExternalStore } from 'react';
import { getJSON, setJSON } from '@storage/mmkv';
import { mockWorkers } from './mockWorkers';

/**
 * Shared worker availability + leave status.
 *
 * WHY THIS EXISTS: availability used to be local `useState` inside WorkerDashboardScreen, so
 * nothing else could see it. The job feed had no idea the worker had gone offline, and the admin
 * portal only ever saw the hardcoded `available` flag from mockWorkers. Three things need the
 * same answer:
 *
 *   1. WorkerDashboardScreen — owns the ONLINE/OFFLINE toggle
 *   2. JobFeedScreen         — must lock accepting while offline / on leave
 *   3. WorkerManagementScreen (admin) — must display Offline / On leave
 *
 * (1) and (2) are different tabs in the SAME session, so they need live updates → the store is
 * subscribe-able and read through useSyncExternalStore. (3) is a different login on the same
 * device, so the toggle must survive a logout → overrides are persisted to MMKV (same
 * synchronous-storage rationale as src/data/mockBookings.js).
 *
 * Only the availability OVERRIDE is stored. Leave is NOT stored: it is derived from the worker's
 * existing approved leaveRequests, so there is no second source of truth to keep in sync.
 */

const STORAGE_KEY = 'sahakar_worker_status';

/** Shape: { [workerId]: { available: boolean } } */
function load() {
  try {
    const parsed = getJSON(STORAGE_KEY);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.error('Error loading worker status:', e);
  }
  return {};
}

// Replaced (never mutated) on every write so useSyncExternalStore sees a new reference and
// re-renders every subscribed screen.
let overrides = load();

const listeners = new Set();

function persist() {
  try {
    setJSON(STORAGE_KEY, overrides);
  } catch (e) {
    console.error('Error saving worker status:', e);
  }
}

export function subscribeWorkerStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable snapshot reference — identity only changes when something actually changed. */
export function getWorkerStatusSnapshot() {
  return overrides;
}

/**
 * The worker's availability. `fallback` is the seed value from the worker record, used until the
 * worker has toggled at least once.
 */
export function getWorkerAvailability(workerId, fallback = true) {
  if (!workerId) return fallback;
  const stored = overrides[workerId]?.available;
  return typeof stored === 'boolean' ? stored : fallback;
}

export function setWorkerAvailability(workerId, available) {
  if (!workerId) return;
  overrides = { ...overrides, [workerId]: { ...(overrides[workerId] || {}), available: !!available } };
  persist();
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

/** YYYY-MM-DD for a Date, in local time (matches how leave dates are authored). */
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * True when an APPROVED leave request covers `today`. Pending/rejected requests are ignored —
 * asking for leave must not take a worker out of the pool before it is granted.
 *
 * Dates are plain 'YYYY-MM-DD' strings, so a lexicographic compare is a correct date compare.
 */
export function isOnLeave(leaveRequests, today = new Date()) {
  const key = dateKey(today);
  return (leaveRequests || []).some(
    (l) => l?.status === 'approved' && l.startDate && l.endDate && l.startDate <= key && key <= l.endDate,
  );
}

/** Same check, by worker id, against the seeded worker records. */
export function isWorkerOnLeave(workerId, today = new Date()) {
  const worker = mockWorkers.find((w) => w.id === workerId);
  return worker ? isOnLeave(worker.leaveRequests, today) : false;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Live availability for a worker, re-rendering whenever the toggle changes anywhere in the app.
 *
 * Returns { available, onLeave, canAcceptJobs } where canAcceptJobs is the single flag screens
 * should gate on — a worker is only able to take work when they are online AND not on leave.
 */
export function useWorkerStatus(workerId, { fallbackAvailable = true, leaveRequests } = {}) {
  useSyncExternalStore(subscribeWorkerStatus, getWorkerStatusSnapshot, getWorkerStatusSnapshot);

  const available = getWorkerAvailability(workerId, fallbackAvailable);
  // Prefer the caller's leave list (the live one from the auth/worker context); fall back to the
  // seeded record so the admin side can ask by id alone.
  const onLeave = leaveRequests ? isOnLeave(leaveRequests) : isWorkerOnLeave(workerId);

  return { available, onLeave, canAcceptJobs: available && !onLeave };
}
