import { mockWorkers } from '@data/mockWorkers';
import {
  getWorkerRegistration,
  registrationCertificates,
  isTrainingBlocked,
  skillNames,
  toSkillIds,
} from '@data/workerRegistration';

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
function withRegistration(base, email) {
  const reg = getWorkerRegistration(email);

  // Skills chosen at registration win; otherwise fall back to whatever the account already had.
  const skills = reg?.skills?.length ? skillNames(reg.skills) : base.skills;
  const skillIds = reg?.skills?.length ? reg.skills : toSkillIds(base.skills);

  // Registration-derived certificates (uploaded experience cert + any issued training cert) are
  // additive — they never replace certificates the account already holds.
  const certificates = [...(base.certificates || []), ...registrationCertificates(reg)];

  return {
    ...base,
    skills,
    skillIds,
    certificates,
    training: reg?.training || null,
    trainingBlocked: isTrainingBlocked(reg),
  };
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
    }, user?.email);
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
  }, user?.email);
}
