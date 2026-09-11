import { useSyncExternalStore } from 'react';
import { getJSON, setJSON } from '@storage/mmkv';
import { mockServices } from './mockServices';

/**
 * Worker registration profile — the skills a worker signed up for, whether they proved experience
 * with a certificate, and their free-offline-training progress.
 *
 * WHY THIS IS LOCAL AND NOT IN SUPABASE:
 * RegisterScreen already sends `skills` (comma-separated) and `wantsTraining` to Supabase, where a
 * DB trigger writes worker_profiles.skills / training_requested. But the new state this feature
 * needs — is the certificate present, is training in progress vs finished, has a completion
 * certificate been issued — has no column to live in, and adding columns/triggers means a schema
 * migration on a database this code cannot reach. So the registration record is persisted locally
 * with MMKV, exactly like src/data/mockBookings.js and src/data/workerStatus.js. The Supabase call
 * is left completely untouched.
 *
 * KEYED BY EMAIL, NOT USER ID: at registration time there may be no user id yet — Supabase can
 * require email confirmation before a session exists, so `user.id` is unknown when the form is
 * submitted. Email is the one stable identifier available both at sign-up and at every later
 * login, so it is the key.
 *
 * SKILLS ARE STORED AS SERVICE IDS (e.g. 'plumbing'), never display names: ids are stable and
 * match booking.serviceId for filtering, while names are localised at render time.
 */

const STORAGE_KEY = 'sahakar_worker_registration';

/** Total modules in the demo training programme — drives the progress bar on the dashboard. */
export const TRAINING_TOTAL_MODULES = 8;

function load() {
  try {
    const parsed = getJSON(STORAGE_KEY);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) {
    console.error('Error loading worker registration:', e);
  }
  return {};
}

// Replaced (never mutated) on write so useSyncExternalStore sees a new reference and re-renders.
let records = load();
const listeners = new Set();

function persist() {
  try {
    setJSON(STORAGE_KEY, records);
  } catch (e) {
    console.error('Error saving worker registration:', e);
  }
}

function emit() {
  listeners.forEach((l) => l());
}

/** Normalises an email into a lookup key. Returns null for anything unusable. */
function keyFor(email) {
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

export function subscribeWorkerRegistration(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWorkerRegistrationSnapshot() {
  return records;
}

// ---------------------------------------------------------------------------
// Service categories (the skills dropdown options)
// ---------------------------------------------------------------------------

/**
 * The job categories a worker can pick, straight from the service catalogue the customer books
 * from — so a worker can never hold a skill the portal has no jobs for.
 */
export const SKILL_OPTIONS = mockServices.map((s) => ({ id: s.id, name: s.name, icon: s.icon }));

/** Display name for a service id; falls back to the raw id so unknown values stay visible. */
export function skillName(serviceId) {
  return mockServices.find((s) => s.id === serviceId)?.name || serviceId;
}

/** Maps stored service ids to display names. */
export function skillNames(serviceIds) {
  return (serviceIds || []).map(skillName);
}

/**
 * Resolves a list that may hold service ids OR display names into service ids.
 *
 * Needed because skills predating this feature are free-text display names — the seeded demo
 * worker carries ['Plumbing', 'Pipe Fitting'], and Supabase worker_profiles.skills is text[] of
 * whatever was typed. Anything with no matching category (e.g. 'Pipe Fitting', which is a skill
 * but not a bookable service) is dropped rather than guessed at.
 */
export function toSkillIds(skills) {
  const out = [];
  (skills || []).forEach((s) => {
    if (typeof s !== 'string') return;
    const needle = s.trim().toLowerCase();
    const match = mockServices.find((svc) => svc.id === needle || svc.name.toLowerCase() === needle);
    if (match && !out.includes(match.id)) out.push(match.id);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/**
 * The stored registration record, or null when this worker never registered through this app
 * (e.g. the seeded demo worker, or an account created before this feature existed).
 */
export function getWorkerRegistration(email) {
  const k = keyFor(email);
  return k ? records[k] || null : null;
}

/**
 * Writes the record captured at sign-up.
 *
 * `wantsTraining` only starts a programme when the worker did NOT upload a certificate — an
 * experienced worker with proof does not get put through the fresher internship, and must not be
 * blocked from taking jobs by it.
 */
export function saveWorkerRegistration(email, { skills = [], hasCertificate = false, certName = null, wantsTraining = false } = {}) {
  const k = keyFor(email);
  if (!k) return null;

  const enrolled = !hasCertificate && !!wantsTraining;
  const record = {
    email: k,
    skills: [...skills],
    hasCertificate: !!hasCertificate,
    certName: certName || null,
    registeredAt: new Date().toISOString(),
    training: enrolled
      ? {
          enrolled: true,
          status: 'in-progress',
          modulesDone: 0,
          modulesTotal: TRAINING_TOTAL_MODULES,
          enrolledAt: new Date().toISOString(),
          completedAt: null,
          certificateIssued: false,
        }
      : null,
  };

  records = { ...records, [k]: record };
  persist();
  emit();
  return record;
}

/**
 * Finishes the training programme and ISSUES THE COMPLETION CERTIFICATE, which is what makes the
 * worker job-eligible. In a real deployment a Seva Kendra instructor would sign this off; in the
 * demo it is triggered from the dashboard banner.
 */
export function completeTraining(email) {
  const k = keyFor(email);
  const existing = k && records[k];
  if (!existing?.training) return null;

  const now = new Date().toISOString();
  const record = {
    ...existing,
    training: {
      ...existing.training,
      status: 'completed',
      modulesDone: existing.training.modulesTotal ?? TRAINING_TOTAL_MODULES,
      completedAt: now,
      certificateIssued: true,
    },
  };

  records = { ...records, [k]: record };
  persist();
  emit();
  return record;
}

/** Advances training by one module; auto-completes (and issues the certificate) on the last one. */
export function advanceTraining(email) {
  const k = keyFor(email);
  const existing = k && records[k];
  if (!existing?.training || existing.training.status === 'completed') return null;

  const total = existing.training.modulesTotal ?? TRAINING_TOTAL_MODULES;
  const done = Math.min(total, (existing.training.modulesDone || 0) + 1);
  if (done >= total) return completeTraining(email);

  records = { ...records, [k]: { ...existing, training: { ...existing.training, modulesDone: done } } };
  persist();
  emit();
  return records[k];
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/**
 * Is this worker allowed to be assigned jobs?
 *
 * Two routes in, mirroring the either/or on the registration form:
 *   - an uploaded experience certificate → job-ready immediately, and
 *   - the free offline training → job-ready only once the programme is finished.
 *
 * Workers with NO record (the seeded demo worker, pre-existing accounts) are job-ready, so this
 * feature cannot retroactively lock anyone out.
 */
export function isTrainingBlocked(record) {
  if (!record) return false;
  if (record.hasCertificate) return false;
  return record.training?.status === 'in-progress';
}

/** The certificates list for a worker, including one auto-issued on training completion. */
export function registrationCertificates(record) {
  if (!record) return [];
  const out = [];
  if (record.hasCertificate) {
    out.push({
      name: record.certName || 'Experience Certificate',
      issuer: 'Self-uploaded',
      date: (record.registeredAt || '').split('T')[0] || '—',
    });
  }
  if (record.training?.certificateIssued) {
    out.push({
      name: `${skillNames(record.skills).join(', ') || 'Skill'} Training Certificate`,
      issuer: 'Sahakar Seva Seva Kendra',
      date: (record.training.completedAt || '').split('T')[0] || '—',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** Live registration record for a worker, re-rendering on any change to the store. */
export function useWorkerRegistration(email) {
  useSyncExternalStore(subscribeWorkerRegistration, getWorkerRegistrationSnapshot, getWorkerRegistrationSnapshot);
  return getWorkerRegistration(email);
}
