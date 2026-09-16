import { mockWorkers } from '@data/mockWorkers';
import {
  getWorkerRegistration,
  registrationCertificates,
  isTrainingBlocked,
  isCertificatePending,
  isCertificateApproved,
  isEkycVerified,
  isBanned,
  skillNames,
  toSkillIds,
} from '@data/workerRegistration';
import { applyStats } from '@data/workerStats';

/**
 * Demo worker resolution — ported VERBATIM from web WorkerDashboard.jsx / WorkerProfile.jsx /
 * LeaveRequests.jsx. Only the explicit 'demo-worker' id maps to the Suresh Kumar mock record
 * (w1). Every real Supabase user sees ONLY their own authenticated data — no generic fallback
 * to mockWorkers. This is a deliberate anti-leak guarantee from the web app; preserved exactly.
 */
export const DEMO_WORKER_ID = 'demo-worker';
export const demoMockWorker = mockWorkers[0]; // Suresh Kumar

/**
 * REGISTRATION OVERLAY (added with the skills-dropdown feature):
 * buildWorkerData is the single place every worker screen resolves its identity through, so it is
 * also where the locally-persisted registration record gets merged in — the skills chosen from the
 * dropdown, whether an experience certificate was uploaded, and training progress. Supabase has no
 * columns for the latter two; see src/data/workerRegistration.js for why they live in MMKV.
 *
 * This function is NOT reactive on its own. Screens that must re-render when training completes
 * call useWorkerRegistration(user?.email) to subscribe; because buildWorkerData runs during render
 * it then picks up the fresh values automatically.
 *
 * Three new fields are returned on top of the original shape:
 *   skillIds        — service ids for job-category filtering (always ids, never display names)
 *   training        — the training record, or null when not enrolled
 *   trainingBlocked — true while an enrolled programme is unfinished, which locks job accepting
 */
function withRegistration(base, email, workerId) {
  const reg = getWorkerRegistration(email);

  /**
   * TRAINING ENROLMENT HAS TWO SOURCES, AND BOTH MUST BE HONOURED.
   *
   * 1. `worker_profiles.training_requested` in Supabase — written by a DB trigger from the
   *    `wantsTraining` flag RegisterScreen sends at sign-up. It is server-side, so it is present for
   *    this worker on EVERY device and survives a reinstall.
   * 2. The local MMKV registration record — richer (module log, trainer, certificate) but
   *    DEVICE-LOCAL, because Supabase has no columns for that detail.
   *
   * THE BUG THIS FIXES: the gate previously consulted only (2). A worker who enrolled in training
   * but whose device has no local record — they registered on another device, reinstalled, cleared
   * data, or signed up before the local store existed — hit `isTrainingBlocked(null)`, which returns
   * false by design (the documented exemption for pre-existing accounts). They were therefore treated
   * as having no programme at all: the Verified badge lit up from `workerProfile.verified` and the
   * job feed let them accept work, even though Supabase knew perfectly well they were a trainee.
   * That is precisely the "logged in on a new account and nothing is fixed" case — the earlier fixes
   * were all correct, but they were reading a record that was not there.
   *
   * PRECEDENCE: the local record wins when it exists, because only it can prove COMPLETION (signed
   * modules + issued certificate). With no local record we fall back to the remote enrolment flag
   * and treat the worker as still in training — i.e. FAIL CLOSED. A trainee wrongly let through takes
   * paid work uncertified; a graduate wrongly held back is unblocked by a trainer or admin signing
   * them off. The second is recoverable, the first is not.
   */
  const remoteTrainingRequested = !!base.trainingRequested;
  const blockedFromJobs = reg ? isTrainingBlocked(reg) : remoteTrainingRequested;

  /**
   * The programme to display. Uses the local record when there is one; otherwise synthesises a
   * read-only stand-in from the remote flag so the training card, progress and status pill still
   * appear for a worker we know is enrolled but hold no module detail for on this device.
   *
   * NOT PERSISTED — derived during render only. See the limitation noted below.
   */
  const trainingForDisplay =
    reg?.training ||
    (remoteTrainingRequested
      ? { status: 'in-progress', modulesDone: 0, modulesTotal: 8, certificateIssued: false, remoteOnly: true }
      : null);

  // Skills chosen at registration win; otherwise fall back to whatever the account already had.
  const skills = reg?.skills?.length ? skillNames(reg.skills) : base.skills;
  const skillIds = reg?.skills?.length ? reg.skills : toSkillIds(base.skills);

  // Registration-derived certificates (uploaded experience cert + any issued training cert) are
  // additive — they never replace certificates the account already holds.
  const certificates = [...(base.certificates || []), ...registrationCertificates(reg)];

  // Completed-job deltas (earnings, weekly hours, rating, quality score, hour cap) are layered on
  // top of the account's seeded baseline. See src/data/workerStats.js.
  return applyStats(
    {
      ...base,
      skills,
      skillIds,
      certificates,
      training: trainingForDisplay,
      trainingBlocked: blockedFromJobs,
      /**
       * IN TRAINING — the status label shown wherever a worker's standing is displayed.
       *
       * True when the worker is enrolled in a programme they have not yet cleared. Derived from the
       * SAME predicate that gates job acceptance, so the label and the lock can never contradict
       * each other: if this is true the worker sees "Training in progress" and Accept is locked; if
       * it is false and a credential exists they are Verified and can accept.
       */
      inTraining: !!trainingForDisplay && blockedFromJobs,
      // Certificate verification + ban state, used to gate the whole worker portal.
      certificate: reg?.certificate || null,
      certificatePending: isCertificatePending(reg),
      banned: isBanned(reg),
      banReason: reg?.banReason || null,
      /**
       * VERIFIED WORKER — the badge shown on the profile.
       *
       * Three routes earn it:
       *   - Aadhaar e-KYC completed, or
       *   - the admin approved the uploaded experience certificate, or
       *   - the worker finished the free offline training AND its certificate was issued.
       *
       * GATED ON THE SAME PREDICATE AS JOB ACCEPTANCE. `blockedFromJobs` (isTrainingBlocked) vetoes
       * the badge outright, then a positive credential must still be present to earn it. Deriving
       * both the badge and the Accept lock from one value is the point: they are two views of the
       * same question ("has this worker cleared verification?") and must never give different
       * answers on the same screen.
       *
       * TWO BUGS THIS FIXES.
       *
       * 1. `!!base.verified` used to sit FIRST in this OR-chain, so it short-circuited every check
       *    below it — and `base.verified` is seed/Supabase data (demoMockWorker.verified is `true`,
       *    and a worker_profiles row may carry its own value), not a credential. A worker enrolled in
       *    training therefore displayed as a Verified Worker having earned nothing, because the badge
       *    was inherited from account seed data. It is now suppressed while blocked, like everything
       *    else.
       *
       * 2. An earlier fix keyed the veto on `certificateIssued` alone, while isTrainingBlocked also
       *    requires every module signed. A record with a certificate but an unsigned module (legacy,
       *    hand-edited or partially synced) then showed Verified while Accept was locked — the exact
       *    contradiction this derivation exists to prevent. Using the predicate itself removes the
       *    possibility by construction.
       *
       * A pending certificate counts as blocked, so it does not earn the badge either — nobody has
       * confirmed it is genuine yet, which is the whole reason it sits in a review queue.
       *
       * Workers with NO registration record (the seeded demo worker, pre-existing accounts) are not
       * blocked, so they keep `base.verified` exactly as before. This cannot retroactively strip
       * anyone's badge.
       */
      verified:
        !blockedFromJobs &&
        (!!base.verified ||
          isEkycVerified(reg) ||
          isCertificateApproved(reg) ||
          !!reg?.training?.certificateIssued),
      // Exposed so the profile can distinguish HOW the badge was earned — an e-KYC-verified worker
      // has a stronger claim than one whose photographed certificate an admin waved through.
      ekyc: reg?.ekyc || null,
    },
    workerId,
  );
}

/** Ported verbatim from WorkerDashboard.buildWorkerData — do not change the resolution rules. */
export function buildWorkerData(user, profile, workerProfile) {
  if (user?.id === DEMO_WORKER_ID) {
    return withRegistration({
      isDemo: true,
      mockWorkerId: demoMockWorker.id, // 'w1' — used to look up demo job history
      name: demoMockWorker.name,
      email: demoMockWorker.email,
      phone: demoMockWorker.phone,
      skills: demoMockWorker.skills,
      cooperative: demoMockWorker.cooperative,
      joinDate: demoMockWorker.joinDate,
      certificates: demoMockWorker.certificates,
      leaveRequests: demoMockWorker.leaveRequests,
      available: demoMockWorker.available,
      verified: demoMockWorker.verified,
      // The demo worker is a seeded veteran, never a trainee, but read the same field so both
      // branches behave identically if a demo profile ever carries it.
      trainingRequested: workerProfile?.training_requested ?? false,
      totalJobs: demoMockWorker.totalJobs,
      earnings: demoMockWorker.earnings,
      rating: demoMockWorker.rating,
      fairnessPosition: demoMockWorker.fairnessPosition,
      cibil_score: workerProfile?.cibil_score ?? 780,
      weekly_hours_worked: workerProfile?.weekly_hours_worked ?? 38,
      insurance_eligible: workerProfile?.insurance_eligible ?? true,
      tier: workerProfile?.tier ?? 'tier2',
      leave_balance: workerProfile?.leave_balance ?? 28,
      loyalty_bonus_eligible: workerProfile?.loyalty_bonus_eligible ?? true,
    }, user?.email, demoMockWorker.id);
  }

  // Real authenticated worker — ONLY use data from auth context.
  return withRegistration({
    isDemo: false,
    mockWorkerId: null,
    name: profile?.full_name || user?.email || 'Worker',
    email: user?.email || '—',
    phone: profile?.phone || workerProfile?.phone || '—',
    skills: workerProfile?.skills || [],
    cooperative: workerProfile?.cooperative || 'Sahakar Seva Cooperative',
    joinDate: profile?.created_at ? new Date(profile.created_at).toISOString().split('T')[0] : '—',
    certificates: workerProfile?.certificates || [],
    leaveRequests: [],
    available: workerProfile?.available ?? true,
    verified: workerProfile?.verified ?? false,
    // Server-side training enrolment, written by the sign-up trigger. Read here because it is the
    // ONLY enrolment signal that exists on a device where this worker never registered. Absent or
    // undefined (e.g. the column does not exist in a given deployment) is simply falsy, so this
    // cannot change behaviour for anyone who is not actually enrolled.
    trainingRequested: workerProfile?.training_requested ?? false,
    totalJobs: workerProfile?.total_jobs ?? 0,
    earnings: workerProfile?.earnings ?? 0,
    rating: workerProfile?.rating ?? null,
    fairnessPosition: workerProfile?.fairness_position ?? null,
    cibil_score: workerProfile?.cibil_score ?? null,
    weekly_hours_worked: workerProfile?.weekly_hours_worked ?? 0,
    insurance_eligible: workerProfile?.insurance_eligible ?? false,
    tier: workerProfile?.tier ?? 'tier2',
    leave_balance: workerProfile?.leave_balance ?? 0,
    loyalty_bonus_eligible: workerProfile?.loyalty_bonus_eligible ?? false,
  }, user?.email, user?.id);
}
