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

/** A fresh training programme, used at sign-up and when a rejected worker is moved into training. */
function newTrainingProgramme() {
  return {
    enrolled: true,
    status: 'in-progress',
    modulesDone: 0,
    modulesTotal: TRAINING_TOTAL_MODULES,
    enrolledAt: new Date().toISOString(),
    completedAt: null,
    certificateIssued: false,
  };
}

/**
 * Writes the record captured at sign-up.
 *
 * An uploaded certificate no longer makes the worker job-ready on the spot — it is SUBMITTED FOR
 * ADMIN VERIFICATION and sits at status 'pending' until a human reviews it. Anyone could otherwise
 * upload any image and start taking jobs. Until it is approved the worker can log in but cannot
 * work; see isCertificatePending / canWork below.
 *
 * `wantsTraining` only starts a programme when no certificate was uploaded — an experienced worker
 * with proof does not get put through the fresher internship.
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
    // Present only when a certificate was uploaded; drives the admin review queue.
    certificate: hasCertificate
      ? {
          status: 'pending',
          name: certName || 'Experience Certificate',
          uploadedAt: new Date().toISOString(),
          reviewedAt: null,
          reason: null,
        }
      : null,
    banned: false,
    banReason: null,
    training: enrolled ? newTrainingProgramme() : null,
  };

  records = { ...records, [k]: record };
  persist();
  emit();
  return record;
}

// ---------------------------------------------------------------------------
// Admin certificate verification
// ---------------------------------------------------------------------------

/** Why a certificate was declined. Drives two very different outcomes — see below. */
export const REJECT_FAKE = 'fake';
export const REJECT_UNQUALIFIED = 'unqualified';

/** Every uploaded certificate still awaiting a decision — the admin review queue. */
export function getPendingCertificates() {
  return Object.values(records)
    .filter((r) => r?.certificate?.status === 'pending')
    .sort((a, b) => (a.certificate.uploadedAt < b.certificate.uploadedAt ? -1 : 1));
}

/** Count for the admin dashboard badge. */
export function getPendingCertificateCount() {
  return getPendingCertificates().length;
}

function update(email, patch) {
  const k = keyFor(email);
  const existing = k && records[k];
  if (!existing) return null;
  records = { ...records, [k]: { ...existing, ...patch } };
  persist();
  emit();
  return records[k];
}

/**
 * Certificate accepted: the worker becomes a verified professional in the skills they registered
 * for, the certificate is attached to their profile, and they can take jobs like any other worker.
 */
export function approveCertificate(email) {
  const existing = getWorkerRegistration(email);
  if (!existing?.certificate) return null;
  return update(email, {
    certificate: { ...existing.certificate, status: 'approved', reviewedAt: new Date().toISOString(), reason: null },
    verified: true,
  });
}

/**
 * Certificate declined as FRAUDULENT: the account is banned. The worker keeps no access — the
 * portal collapses to a logout screen and any future login is refused with the reason. This is
 * deliberately the harshest branch, which is why the admin UI confirms before calling it.
 */
export function rejectCertificateAsFake(email) {
  const existing = getWorkerRegistration(email);
  if (!existing?.certificate) return null;
  return update(email, {
    certificate: { ...existing.certificate, status: 'rejected', reviewedAt: new Date().toISOString(), reason: REJECT_FAKE },
    banned: true,
    banReason: REJECT_FAKE,
    verified: false,
  });
}

/**
 * Certificate declined as INSUFFICIENT for the trade: no ban. The account is moved into the free
 * offline training programme instead, which is the same state a fresher who opted into training at
 * sign-up is in — so the existing training dashboard, progress bar and completion flow all apply
 * unchanged, and the worker becomes employable once they finish.
 */
export function rejectCertificateAsUnqualified(email) {
  const existing = getWorkerRegistration(email);
  if (!existing?.certificate) return null;
  return update(email, {
    certificate: { ...existing.certificate, status: 'rejected', reviewedAt: new Date().toISOString(), reason: REJECT_UNQUALIFIED },
    // The uploaded certificate no longer counts as proof of experience...
    hasCertificate: false,
    // ...and the worker is enrolled in training, unless somehow already in a programme.
    training: existing.training || newTrainingProgramme(),
    banned: false,
    verified: false,
  });
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

/** True while an uploaded certificate is still waiting on the admin's decision. */
export function isCertificatePending(record) {
  return record?.certificate?.status === 'pending';
}

/** True once an uploaded certificate has been accepted by the admin. */
export function isCertificateApproved(record) {
  return record?.certificate?.status === 'approved';
}

/** True when the account has been banned (currently only ever for a fraudulent certificate). */
export function isBanned(record) {
  return !!record?.banned;
}

/**
 * Is this worker blocked from taking jobs by their training/verification state?
 *
 * Routes to being employable:
 *   - an uploaded certificate that the ADMIN HAS APPROVED, or
 *   - finishing the free offline training programme.
 *
 * Blocked while:
 *   - a certificate is still pending review (nobody has confirmed it is genuine yet), or
 *   - an enrolled training programme is unfinished.
 *
 * Workers with NO record (the seeded demo worker, pre-existing accounts) are employable, so this
 * feature cannot retroactively lock anyone out.
 */
export function isTrainingBlocked(record) {
  if (!record) return false;
  if (isCertificatePending(record)) return true;
  if (isCertificateApproved(record)) return false;
  return record.training?.status === 'in-progress';
}

/** The certificates list for a worker, including one auto-issued on training completion. */
export function registrationCertificates(record) {
  if (!record) return [];
  const out = [];
  // Only an APPROVED certificate is attached to the profile. A pending one is not yet proof of
  // anything, and a rejected one must never appear as a credential.
  if (isCertificateApproved(record)) {
    out.push({
      name: record.certName || 'Experience Certificate',
      issuer: 'Verified by cooperative admin',
      date: (record.certificate?.reviewedAt || record.registeredAt || '').split('T')[0] || '—',
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

/**
 * Skill counts across every worker who registered through this app and is actually employable —
 * i.e. not banned, and either certificate-approved or finished with training.
 *
 * WHY THIS EXISTS: the admin forecast's staffing gap was computed from mockWorkers alone, so a
 * worker who signed up in the app, picked their trades and had their certificate approved counted
 * for nothing. The forecast would keep reporting a shortage of electricians right after three were
 * onboarded.
 *
 * Returns { [serviceId]: count } keyed by service id, matching the forecast's category ids.
 *
 * Note this is device-local: MMKV only holds registrations made on this device (see the note in
 * ml/README.md about cross-device aggregation needing a backend).
 */
export function getAllRegisteredSkillCounts() {
  const counts = {};
  Object.values(records).forEach((rec) => {
    if (!rec || rec.banned) return;
    if (isTrainingBlocked(rec)) return; // still pending verification or mid-training
    (rec.skills || []).forEach((serviceId) => {
      counts[serviceId] = (counts[serviceId] || 0) + 1;
    });
  });
  return counts;
}

/** Live registration record for a worker, re-rendering on any change to the store. */
export function useWorkerRegistration(email) {
  useSyncExternalStore(subscribeWorkerRegistration, getWorkerRegistrationSnapshot, getWorkerRegistrationSnapshot);
  return getWorkerRegistration(email);
}
