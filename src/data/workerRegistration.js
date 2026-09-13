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

/**
 * The training curriculum, in order.
 *
 * WHY NAMED MODULES: progress used to be a bare "3 of 8", which tells a trainee nothing about what
 * they have actually learnt and gives a trainer nothing to assess against. Named modules make the
 * trainer's job concrete (tick what this person can demonstrably do) and make the admin's oversight
 * meaningful (see exactly where someone stalled).
 *
 * Length is deliberately 8, matching TRAINING_TOTAL_MODULES, so records persisted before this change
 * keep their existing modulesDone/modulesTotal without migration — see trainingModules().
 *
 * Titles are translated at the point of display via the `key`; the English `name` is the fallback
 * and is also what gets written into the module log, so an audit trail stays readable regardless of
 * which language the trainer was using.
 */
export const TRAINING_MODULES = [
  { key: 'tm_safety', name: 'Workplace Safety & PPE' },
  { key: 'tm_tools', name: 'Tools & Equipment Handling' },
  { key: 'tm_fundamentals', name: 'Trade Fundamentals' },
  { key: 'tm_practice', name: 'Supervised Hands-on Practice' },
  { key: 'tm_assessment', name: 'Practical Skills Assessment' },
  { key: 'tm_customer', name: 'Customer Communication' },
  { key: 'tm_billing', name: 'Pricing, Billing & Using the App' },
  { key: 'tm_final', name: 'Final Assessment' },
];

/** Who signed a module off. Recorded so progress is auditable rather than anonymous. */
export const MARKED_BY_TRAINER = 'trainer';
export const MARKED_BY_ADMIN = 'admin';

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
export function saveWorkerRegistration(email, { skills = [], hasCertificate = false, certName = null, wantsTraining = false, ekyc = null } = {}) {
  const k = keyFor(email);
  if (!k) return null;

  // An e-KYC-verified worker is employable immediately, so the fresher training programme would be
  // busywork — same reasoning as an uploaded certificate suppressing it.
  const enrolled = !hasCertificate && !ekyc && !!wantsTraining;
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
    // { status, aadhaarLast4, name, occupation, verifiedAt, method } — or null if this route was
    // not used. Only the last four Aadhaar digits are ever kept; see EkycModal.
    ekyc: ekyc || null,
    // e-KYC needs no human review, so the worker is verified the moment it completes.
    verified: !!ekyc,
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

// ---------------------------------------------------------------------------
// e-KYC
// ---------------------------------------------------------------------------

/**
 * Aadhaar-based e-KYC — the third route to becoming an employable worker.
 *
 * WHY IT BYPASSES ADMIN REVIEW, where an uploaded certificate does not:
 * a photographed certificate proves nothing on its own. Anyone can photograph anyone's document,
 * which is exactly why that path sits in a queue for a human to look at. An e-KYC response comes
 * from the government record itself, so there is no document to doubt and nothing for an admin to
 * adjudicate — the check either succeeded or it did not.
 *
 * It also answers the obvious objection that identity is not skill: India's e-Shram registry records
 * a worker's OCCUPATION alongside their identity, so an e-KYC pull legitimately returns the trade
 * they are registered for. That is what makes this a verification route rather than just an ID check.
 *
 * SIMULATED IN THIS BUILD. There is no UIDAI integration, no Aadhaar number is transmitted, and only
 * the last four digits are ever retained — see src/components/ui/EkycModal.jsx. The stored shape is
 * deliberately the same one a real integration would produce, so wiring a live provider later is a
 * change of source, not a change of schema.
 */
export const EKYC_VERIFIED = 'verified';

/** True once e-KYC has completed successfully for this worker. */
export function isEkycVerified(record) {
  return record?.ekyc?.status === EKYC_VERIFIED;
}

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

// ---------------------------------------------------------------------------
// Mentorship: who is training whom, and who signed off what
// ---------------------------------------------------------------------------

/**
 * Can this worker act as a TRAINER for someone else?
 *
 * Only a worker who is verified themselves. Letting a trainee sign off another trainee would make
 * the whole programme circular — two unverified people could certify each other into being
 * employable. Being verified means one of: e-KYC, an admin-approved certificate, or having finished
 * this same programme (a graduate mentoring the next intake is exactly the cooperative model).
 *
 * Banned workers are excluded outright, and anyone still blocked by their own verification cannot
 * train either.
 */
export function canTrain(record) {
  if (!record) return false;
  if (isBanned(record)) return false;
  if (isTrainingBlocked(record)) return false;
  return isEkycVerified(record) || isCertificateApproved(record) || !!record.training?.certificateIssued;
}

/** Everyone currently mid-programme — the pool a trainer or admin works from. */
export function getTrainees() {
  return Object.values(records)
    .filter((r) => r?.training?.status === 'in-progress' && !r.banned)
    .sort((a, b) => String(a.training.enrolledAt || '').localeCompare(String(b.training.enrolledAt || '')));
}

/** Trainees assigned to one specific trainer. */
export function getTraineesForTrainer(trainerEmail) {
  const k = keyFor(trainerEmail);
  if (!k) return [];
  return getTrainees().filter((r) => r.training?.trainerEmail === k);
}

/** Trainees nobody has picked up yet. */
export function getUnassignedTrainees() {
  return getTrainees().filter((r) => !r.training?.trainerEmail);
}

/**
 * The curriculum as it stands for one trainee: every module, whether it is done, and who signed it.
 *
 * HANDLES LEGACY RECORDS. Programmes started before module-level tracking existed have only a
 * `modulesDone` count and no log. Rather than migrate them destructively, the first `modulesDone`
 * modules are treated as complete with unknown attribution — so an existing trainee's progress bar
 * does not reset to zero, and the trainer simply carries on from where the count left off.
 */
export function trainingModules(record) {
  const training = record?.training;
  if (!training) return [];

  const log = Array.isArray(training.moduleLog) ? training.moduleLog : [];
  const doneCount = training.modulesDone || 0;

  return TRAINING_MODULES.map((mod, index) => {
    const entry = log.find((l) => l.index === index);
    // No log entry, but the legacy counter says this far was reached.
    const doneByCount = !log.length && index < doneCount;
    return {
      index,
      key: mod.key,
      name: mod.name,
      done: entry ? true : doneByCount,
      at: entry?.at || null,
      byName: entry?.byName || null,
      byRole: entry?.byRole || null,
    };
  });
}

/**
 * Assigns (or reassigns) a trainer to a trainee.
 *
 * REFUSES SELF-ASSIGNMENT. A worker must never be their own trainer: it would let a trainee sign
 * off their own curriculum and certify themselves into being employable, which is the single thing
 * this whole mentorship model exists to prevent. This was reachable in practice — the worker's
 * Training tab listed an "unassigned trainees" pool that included the worker themselves, so tapping
 * their own row made them their own mentor, after which every module they ticked was "verified" by
 * nobody but themselves.
 */
export function assignTrainer(traineeEmail, trainer = {}) {
  const existing = getWorkerRegistration(traineeEmail);
  if (!existing?.training) return null;

  const traineeKey = keyFor(traineeEmail);
  const trainerKey = keyFor(trainer.email);
  if (traineeKey && trainerKey && traineeKey === trainerKey) return null;

  return update(traineeEmail, {
    training: {
      ...existing.training,
      trainerEmail: keyFor(trainer.email),
      trainerName: trainer.name || null,
      assignedAt: new Date().toISOString(),
    },
  });
}

/**
 * Marks one module done or not-done, recording WHO did it.
 *
 * `by` is { email, name, role } where role is MARKED_BY_TRAINER or MARKED_BY_ADMIN. Attribution is
 * the point of this function: a trainee's employability now rests on these ticks, so it must be
 * possible to see who vouched for each one.
 *
 * Un-marking is allowed so an honest mistake can be corrected. It removes the log entry rather than
 * recording a reversal, which keeps the model simple; the trade-off is that a corrected tick leaves
 * no trace. That is acceptable while a cooperative admin can see current state, and would need
 * revisiting if this ever had to satisfy an external audit.
 *
 * Reaching the final module does NOT auto-complete the programme. Completion is a separate,
 * deliberate sign-off — see completeTraining.
 */
export function setModuleDone(traineeEmail, index, done, by = {}) {
  const existing = getWorkerRegistration(traineeEmail);
  if (!existing?.training) return null;
  if (index < 0 || index >= TRAINING_MODULES.length) return null;
  // A finished programme is immutable; reopening it would silently revoke a certificate already
  // issued and, with it, the worker's ability to accept jobs.
  if (existing.training.status === 'completed') return null;

  // NOBODY SIGNS OFF THEIR OWN MODULES. Attribution is the entire point of the module log — a tick
  // that the trainee applied to themselves proves nothing and is indistinguishable from the
  // self-complete button this function was built to replace.
  const traineeKey = keyFor(traineeEmail);
  const signerKey = keyFor(by.email);
  if (traineeKey && signerKey && traineeKey === signerKey) return null;

  // Materialise legacy count-only progress into real log entries before editing, so the two
  // representations never disagree.
  const current = trainingModules(existing);
  const log = current
    .filter((m) => (m.index === index ? done : m.done))
    .map((m) => {
      const existingEntry = (existing.training.moduleLog || []).find((l) => l.index === m.index);
      if (existingEntry) return existingEntry;
      return {
        index: m.index,
        name: m.name,
        at: m.index === index ? new Date().toISOString() : existing.training.enrolledAt || null,
        byEmail: m.index === index ? keyFor(by.email) : null,
        byName: m.index === index ? by.name || null : null,
        byRole: m.index === index ? by.role || MARKED_BY_TRAINER : null,
      };
    })
    .sort((a, b) => a.index - b.index);

  return update(traineeEmail, {
    training: {
      ...existing.training,
      moduleLog: log,
      modulesDone: log.length,
    },
  });
}

/**
 * Finishes the training programme and ISSUES THE COMPLETION CERTIFICATE, which is what makes the
 * worker job-eligible.
 *
 * `by` records who signed off — a trainer or the cooperative admin. It is optional only so the
 * seeded/demo path and older call sites keep working; every UI route passes it.
 *
 * NOTE this is no longer callable by the trainee themselves. A worker marking their own programme
 * complete defeated the purpose of having a programme at all.
 */
export function completeTraining(email, by = null) {
  const k = keyFor(email);
  const existing = k && records[k];
  if (!existing?.training) return null;

  // A trainee cannot sign off their own completion — see setModuleDone for the same guard. This is
  // the highest-value target of the three, since completion is what issues the certificate.
  const selfSignKey = by ? keyFor(by.email) : null;
  if (k && selfSignKey && k === selfSignKey) return null;

  const now = new Date().toISOString();
  const total = existing.training.modulesTotal ?? TRAINING_TOTAL_MODULES;

  // Signing off completion implies every module is accounted for, so any not yet ticked are filled
  // in and attributed to whoever signed off — otherwise the certificate would contradict a
  // checklist showing gaps.
  const filled = trainingModules(existing).map((m) => {
    const entry = (existing.training.moduleLog || []).find((l) => l.index === m.index);
    if (entry) return entry;
    return {
      index: m.index,
      name: m.name,
      at: now,
      byEmail: by ? keyFor(by.email) : null,
      byName: by?.name || null,
      byRole: by?.role || null,
    };
  });

  const record = {
    ...existing,
    // AUTOMATIC TRANSITION TO VERIFIED. Finishing the programme and receiving the certificate is
    // one of the three routes to being a verified worker, so the record now says so explicitly
    // instead of leaving `verified` at the false it was created with.
    //
    // Previously this function touched only `training`, so a graduate's record kept `verified:
    // false` while every derived consumer reported them verified (via training.certificateIssued).
    // Nothing read the raw field, which is why it went unnoticed — but it left a stale second
    // source of truth that would silently return the wrong answer to the next caller that trusted
    // it. The two now agree.
    verified: true,
    training: {
      ...existing.training,
      status: 'completed',
      modulesDone: total,
      moduleLog: filled,
      completedAt: now,
      certificateIssued: true,
      completedByName: by?.name || null,
      completedByRole: by?.role || null,
    },
  };

  records = { ...records, [k]: record };
  persist();
  emit();
  return record;
}

// advanceTraining() used to live here: it bumped modulesDone by one and auto-completed the
// programme on the last module. Removed in favour of setModuleDone + completeTraining, because
// module-level progress now carries attribution (who signed this off) and completion is a
// deliberate act rather than a side effect of reaching the end of a counter. It had no callers.

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
 *   - finishing the free offline training programme IN FULL.
 *
 * Blocked while:
 *   - a certificate is still pending review (nobody has confirmed it is genuine yet), or
 *   - an enrolled training programme has ANY module unsigned, or no certificate issued yet.
 *
 * A TRAINEE IS BLOCKED UNTIL BOTH CONDITIONS HOLD: every module in the curriculum is signed off,
 * AND the completion certificate has been issued. The two are checked separately on purpose —
 * ticking the last module does not itself finish the programme (completion is a deliberate
 * sign-off, see completeTraining), and conversely a certificate must never make an incomplete
 * checklist employable. Requiring both means neither half can let someone through on its own.
 *
 * This FAILS CLOSED. The previous implementation ended with
 *   `return record.training?.status === 'in-progress'`
 * which asked only whether one exact string matched. Any other value — undefined, a legacy value,
 * a future 'paused'/'withdrawn' — returned false, i.e. NOT blocked, so a trainee with a malformed
 * or unrecognised programme status became employable by accident. It also never looked at module
 * progress or the certificate at all, so a programme marked done with gaps still passed. For a gate
 * on employability the safe direction is to stay locked unless the record positively proves
 * completion, which is what this now does.
 *
 * Workers with NO record (the seeded demo worker, pre-existing accounts) are employable, so this
 * feature cannot retroactively lock anyone out. That exemption is unchanged.
 */
export function isTrainingBlocked(record) {
  if (!record) return false;
  // Checked FIRST, and deliberately so: a government-backed identity + occupation check settles the
  // question on its own. If a worker completed e-KYC and also happened to upload a certificate, the
  // certificate sitting in the review queue must not hold them back.
  if (isEkycVerified(record)) return false;
  if (isCertificatePending(record)) return true;
  if (isCertificateApproved(record)) return false;

  // Never enrolled in a programme — there is nothing to finish, so nothing to block on.
  if (!record.training) return false;

  // Enrolled: every module signed off AND the certificate issued. trainingModules() is the single
  // source of per-module truth (it also resolves legacy count-only records), so this cannot drift
  // from what the trainee, trainer and admin all see on the checklist.
  const modules = trainingModules(record);
  const everyModuleSigned = modules.length > 0 && modules.every((m) => m.done);
  if (!(everyModuleSigned && !!record.training.certificateIssued)) return true;

  /**
   * Complete on paper — but was the programme ever SUPERVISED?
   *
   * A programme with no trainer assigned AND no completion attribution was signed off by nobody.
   * That is the shape a self-certified record has, and self-certification is precisely what this
   * whole mentorship model exists to prevent: the certificate would be asserting competence that no
   * verified person ever assessed. Such a record must not confer verification or job eligibility.
   *
   * EITHER form of supervision satisfies this:
   *   - a trainer was assigned (the normal peer-mentorship route), or
   *   - the completion carries sign-off attribution (`completedByRole`/`completedByName`), which is
   *     what an admin offline assessment produces without any trainer being involved.
   *
   * So the legitimate admin route is preserved, while an unsupervised record stays blocked. This
   * also removes a visible contradiction: the dashboard showed "Awaiting trainer assignment" next to
   * a Verified badge, because the label keys on trainerEmail while the badge keyed only on the
   * certificate.
   */
  // SELF-SUPERVISION IS NOT SUPERVISION. A record whose trainer is the trainee themselves, or whose
  // completion was signed off by the trainee, is self-certified. The write paths now refuse this
  // (assignTrainer / setModuleDone / completeTraining), but records corrupted BEFORE those guards
  // existed are already persisted on devices, so the read path rejects them too — otherwise an
  // account that made itself its own trainer would stay verified for ever.
  const selfTrained = !!record.training.trainerEmail && record.training.trainerEmail === record.email;
  if (selfTrained) return true;

  const hadTrainer = !!record.training.trainerEmail;
  const wasSignedOff = !!record.training.completedByRole || !!record.training.completedByName;
  return !(hadTrainer || wasSignedOff);
}

/** The certificates list for a worker, including one auto-issued on training completion. */
export function registrationCertificates(record) {
  if (!record) return [];
  const out = [];
  // e-KYC listed first: it is the strongest credential of the three, being the only one backed by a
  // government record rather than a photograph or an internal programme.
  if (isEkycVerified(record)) {
    out.push({
      name: 'Aadhaar e-KYC Verified',
      issuer: record.ekyc?.occupation
        ? `Identity + occupation (${record.ekyc.occupation}) confirmed`
        : 'Government identity verification',
      date: (record.ekyc?.verifiedAt || '').split('T')[0] || '—',
    });
  }
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
