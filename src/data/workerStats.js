import { useSyncExternalStore } from 'react';
import { getJSON, setJSON } from '@storage/mmkv';

/**
 * Accumulated worker performance — earnings, jobs done, weekly hours, customer rating and the
 * CIBIL-style quality score.
 *
 * WHY A SEPARATE STORE: the seeded totals live in mockWorkers (demo worker) and in Supabase
 * worker_profiles (real workers), and neither can be written to from here — mockWorkers is a
 * static seed module and worker_profiles has no client-side update path in this app. So completing
 * a job records a DELTA here, which buildWorkerData adds on top of whatever baseline the account
 * already had. Same MMKV pattern as mockBookings / workerStatus / workerRegistration.
 *
 * Keyed by worker id (the demo worker's mock id 'w1', or the authenticated user id) because that
 * is what a booking's workerId holds, so a completed job can always be attributed.
 */

const STORAGE_KEY = 'sahakar_worker_stats';

/** Weekly hour ceiling. At this point a worker may not go online again until the week resets. */
export const WEEKLY_HOUR_CAP = 40;

/** Hours credited per completed job. */
export const HOURS_PER_JOB = 2;

/**
 * Quality-score movement per job. A good rating nudges the score up, a poor one pulls it down;
 * a complaint costs more than a bad rating alone. Clamped to a realistic CIBIL-like band.
 */
const SCORE_MIN = 300;
const SCORE_MAX = 900;

function load() {
  try {
    const parsed = getJSON(STORAGE_KEY);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.error('Error loading worker stats:', e);
  }
  return {};
}

let stats = load();
const listeners = new Set();

function commit() {
  try {
    setJSON(STORAGE_KEY, stats);
  } catch (e) {
    console.error('Error saving worker stats:', e);
  }
  listeners.forEach((l) => l());
}

export function subscribeWorkerStats(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkerStatsSnapshot() {
  return stats;
}

const EMPTY = {
  earningsDelta: 0,
  jobsDelta: 0,
  hoursDelta: 0,
  scoreDelta: 0,
  ratings: [],
  lastPaidBookingId: null,
  lastPaidAmount: 0,
  paymentAcknowledged: true,
  weekStart: null,
};

/** ISO date (YYYY-MM-DD) of the Monday that starts the given date's week. */
function weekStartKey(d = new Date()) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay(); // 0 = Sunday
  const backToMonday = dow === 0 ? 6 : dow - 1;
  copy.setDate(copy.getDate() - backToMonday);
  return `${copy.getFullYear()}-${String(copy.getMonth() + 1).padStart(2, '0')}-${String(copy.getDate()).padStart(2, '0')}`;
}

/**
 * The worker's deltas, with the weekly hour counter auto-reset when the calendar week rolls over.
 * Earnings/jobs/score are cumulative and never reset; only hours are weekly.
 */
export function getWorkerStats(workerId) {
  if (!workerId) return { ...EMPTY };
  const raw = stats[workerId];
  if (!raw) return { ...EMPTY };

  const thisWeek = weekStartKey();
  if (raw.weekStart && raw.weekStart !== thisWeek) {
    // New week — hours start again from zero. Returned lazily so a read never has to write.
    return { ...EMPTY, ...raw, hoursDelta: 0, weekStart: thisWeek };
  }
  return { ...EMPTY, ...raw };
}

function write(workerId, next) {
  stats = { ...stats, [workerId]: next };
  commit();
}

/**
 * Records a completed + paid job against the worker: earnings, job count, +2 weekly hours, the
 * customer's rating, and a quality-score adjustment. Also parks a "you have been paid" notice for
 * the worker portal to surface once.
 */
export function recordCompletedJob(workerId, { amount = 0, rating = null, hasComplaint = false, bookingId = null, hours = HOURS_PER_JOB } = {}) {
  if (!workerId) return null;
  const current = getWorkerStats(workerId);

  // Score movement: strong ratings build the score, weak ones erode it, a complaint costs extra.
  let scoreMove = 0;
  if (rating != null) scoreMove += rating >= 4 ? 6 : rating >= 3 ? 1 : -8;
  else scoreMove += 2; // job done, no rating given
  if (hasComplaint) scoreMove -= 12;

  const next = {
    ...current,
    earningsDelta: current.earningsDelta + amount,
    jobsDelta: current.jobsDelta + 1,
    hoursDelta: current.hoursDelta + hours,
    scoreDelta: current.scoreDelta + scoreMove,
    ratings: rating != null ? [...current.ratings, rating] : current.ratings,
    lastPaidBookingId: bookingId,
    lastPaidAmount: amount,
    paymentAcknowledged: false,
    weekStart: weekStartKey(),
  };
  write(workerId, next);
  return next;
}

/** Dismisses the "you have been paid" notice so it is shown once, not on every dashboard visit. */
export function acknowledgePayment(workerId) {
  if (!workerId) return;
  const current = getWorkerStats(workerId);
  write(workerId, { ...current, paymentAcknowledged: true });
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** Baseline + delta, so seeded demo figures still show and then grow as jobs complete. */
export function applyStats(base, workerId) {
  const d = getWorkerStats(workerId);

  const hours = (base.weekly_hours_worked || 0) + d.hoursDelta;
  // Average the customer ratings collected here into the account's existing rating.
  let rating = base.rating;
  if (d.ratings.length) {
    const seeded = base.rating != null ? [base.rating] : [];
    const all = [...seeded, ...d.ratings];
    rating = all.reduce((s, r) => s + r, 0) / all.length;
  }

  const score = base.cibil_score != null
    ? Math.max(SCORE_MIN, Math.min(SCORE_MAX, base.cibil_score + d.scoreDelta))
    : base.cibil_score;

  return {
    ...base,
    earnings: (base.earnings || 0) + d.earningsDelta,
    totalJobs: (base.totalJobs || 0) + d.jobsDelta,
    weekly_hours_worked: hours,
    rating,
    cibil_score: score,
    hourCapped: hours >= WEEKLY_HOUR_CAP,
    pendingPayment: d.paymentAcknowledged ? null : { bookingId: d.lastPaidBookingId, amount: d.lastPaidAmount },
  };
}

/** Subscribes a component to stat changes. */
export function useWorkerStats() {
  return useSyncExternalStore(subscribeWorkerStats, getWorkerStatsSnapshot, getWorkerStatsSnapshot);
}
