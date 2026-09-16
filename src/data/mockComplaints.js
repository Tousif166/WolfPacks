import { useSyncExternalStore } from 'react';
import { getJSON, setJSON } from '@storage/mmkv';

/**
 * Complaints, seeded then persisted.
 *
 * Originally a static array. It now needs to accept complaints the customer files from the payment
 * flow and have them survive a logout, because the admin reads them from a different login
 * session — same MMKV-persisted-singleton pattern as mockBookings.js.
 *
 * COMPLAINTS RUN BOTH WAYS. `filedBy` records who raised it and `against` who it is about:
 *
 *   filedBy 'customer', against 'worker'   — the original direction (payment flow feedback)
 *   filedBy 'worker',   against 'customer' — a worker reporting the experience on a finished job
 *
 * Both directions live in ONE collection rather than two, because the admin dashboard, the open
 * count, resolution and the AI suggestion all behave identically regardless of direction — only
 * the filtering differs. Splitting them would duplicate every one of those.
 *
 * AI SUGGESTION: `aiStatus` / `aiSuggestion` hold a Groq-generated de-escalation suggestion, filled
 * in by a background worker (src/services/complaintAdvisor.js) rather than at file time, so nothing
 * in the UI waits on a network call.
 */

const STORAGE_KEY = 'sahakar_complaints';

/** Who raised a complaint / who it is about. */
export const BY_CUSTOMER = 'customer';
export const BY_WORKER = 'worker';

/** AI suggestion lifecycle. 'idle' = not requested yet; the advisor moves it forward. */
export const AI_IDLE = 'idle';
export const AI_PENDING = 'pending';
export const AI_DONE = 'done';
export const AI_ERROR = 'error';

const INITIAL_COMPLAINTS = [
  {
    id: 'CMP001',
    customerId: 'c1',
    customerName: 'Rahul Sharma',
    workerId: 'w2',
    workerName: 'Ramesh Yadav',
    bookingId: 'BK002',
    serviceName: 'Electrical',
    subject: 'Worker arrived 45 minutes late',
    description: 'The worker was supposed to arrive at 2:00 PM but came at 2:45 PM without any prior notification. The work was done well but the delay was inconvenient.',
    status: 'open',
    priority: 'medium',
    createdAt: '2026-08-28T16:30:00',
    resolvedAt: null,
    resolution: null
  },
  {
    id: 'CMP002',
    customerId: 'c2',
    customerName: 'Priya Patel',
    workerId: 'w1',
    workerName: 'Suresh Kumar',
    bookingId: 'BK003',
    serviceName: 'Plumbing',
    subject: 'Incomplete work — leak returned after 2 days',
    description: 'The plumber fixed the kitchen sink but the leak returned after 2 days. Requesting a free revisit to complete the repair properly.',
    status: 'in-progress',
    priority: 'high',
    createdAt: '2026-08-26T10:00:00',
    resolvedAt: null,
    resolution: null
  },
  {
    id: 'CMP003',
    customerId: 'c1',
    customerName: 'Rahul Sharma',
    workerId: 'w3',
    workerName: 'Meena Devi',
    bookingId: 'BK003',
    serviceName: 'Cleaning',
    subject: 'Overcharged for cleaning supplies',
    description: 'Was charged ₹200 extra for cleaning supplies which were not discussed during booking. Requesting refund for the additional charge.',
    status: 'resolved',
    priority: 'low',
    createdAt: '2026-08-25T14:00:00',
    resolvedAt: '2026-08-27T11:00:00',
    resolution: 'Refund of ₹200 processed. Worker counseled about transparent pricing.'
  },
  {
    id: 'CMP004',
    customerId: 'c2',
    customerName: 'Priya Patel',
    workerId: 'w4',
    workerName: 'Vikram Singh',
    bookingId: 'BK004',
    serviceName: 'AC Repair',
    subject: 'Worker was unprofessional',
    description: 'The worker made personal phone calls during the service and took multiple breaks. Total service time was 3 hours for what should have been a 1-hour job.',
    status: 'open',
    priority: 'high',
    createdAt: '2026-08-30T18:00:00',
    resolvedAt: null,
    resolution: null
  }
];

/**
 * Fills in fields that did not exist when a record was written.
 *
 * Needed because complaints already persisted on a device predate `filedBy`/`against` and the AI
 * fields. Every one of those was raised by a customer about a worker (the only direction that
 * existed), so that is the safe default — guessing otherwise would silently mislabel real records.
 */
function normalise(complaint) {
  if (!complaint) return complaint;
  return {
    ...complaint,
    filedBy: complaint.filedBy || BY_CUSTOMER,
    against: complaint.against || BY_WORKER,
    aiStatus: complaint.aiStatus || AI_IDLE,
    aiSuggestion: complaint.aiSuggestion ?? null,
    rating: complaint.rating ?? null,
  };
}

function loadStored() {
  try {
    const parsed = getJSON(STORAGE_KEY);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(normalise);
  } catch (e) {
    console.error('Error loading stored complaints:', e);
  }
  return INITIAL_COMPLAINTS.map(normalise);
}

export let mockComplaints = loadStored();

let version = 0;
const listeners = new Set();

export function subscribeComplaints(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getComplaintsVersion() {
  return version;
}

function commit() {
  try {
    setJSON(STORAGE_KEY, mockComplaints);
  } catch (e) {
    console.error('Error saving complaints:', e);
  }
  version += 1;
  listeners.forEach((l) => l());
}

export const getComplaintsByStatus = (status) =>
  status === 'all' ? mockComplaints : mockComplaints.filter(c => c.status === status);

/**
 * Files a complaint about a completed job. Opens as 'open' so it lands in the admin dashboard's
 * open-complaints count immediately, and at aiStatus 'idle' so the background advisor picks it up.
 *
 * `filedBy` defaults to 'customer' to keep the original call sites (the payment flow) unchanged.
 */
export function addComplaint({
  customerId, customerName, workerId, workerName, bookingId, serviceName,
  subject, description, priority = 'medium', filedBy = BY_CUSTOMER, rating = null,
}) {
  const complaint = {
    // Timestamp-suffixed rather than length-based: two complaints filed after one was removed could
    // otherwise collide on the same id.
    id: `CMP${String(mockComplaints.length + 1).padStart(3, '0')}-${Date.now().toString(36).slice(-4)}`,
    customerId: customerId ?? null,
    customerName: customerName || 'Customer',
    workerId: workerId ?? null,
    workerName: workerName || '—',
    bookingId: bookingId ?? null,
    serviceName: serviceName || '—',
    subject: subject || 'Service complaint',
    description: description || '',
    status: 'open',
    priority,
    filedBy,
    against: filedBy === BY_WORKER ? BY_CUSTOMER : BY_WORKER,
    rating,
    aiStatus: AI_IDLE,
    aiSuggestion: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolution: null,
  };
  mockComplaints = [complaint, ...mockComplaints];
  commit();
  return complaint;
}

/** Convenience wrapper for the worker-side form: a worker reporting a customer. */
export function addWorkerComplaint(fields) {
  return addComplaint({ ...fields, filedBy: BY_WORKER });
}

// ---------------------------------------------------------------------------
// Direction-aware selectors
// ---------------------------------------------------------------------------

/** Complaints a customer filed about workers — the original direction. */
export const getCustomerFiledComplaints = () =>
  mockComplaints.filter((c) => c.filedBy === BY_CUSTOMER);

/** Complaints workers filed about customers — the worker-feedback section in the admin portal. */
export const getWorkerFiledComplaints = () =>
  mockComplaints.filter((c) => c.filedBy === BY_WORKER);

/**
 * Open complaints levelled AT a specific customer, for the alert in their portal.
 * Resolved ones are excluded — a closed matter should stop nagging them.
 */
export const getComplaintsAgainstCustomer = (customerId) =>
  !customerId ? [] : mockComplaints.filter(
    (c) => c.against === BY_CUSTOMER && c.customerId === customerId && c.status !== 'resolved',
  );

/** Open complaints levelled AT a specific worker, for the notice in their portal. */
export const getComplaintsAgainstWorker = (workerId) =>
  !workerId ? [] : mockComplaints.filter(
    (c) => c.against === BY_WORKER && c.workerId === workerId && c.status !== 'resolved',
  );

/** Has this worker already given feedback on this job? Keeps the form to one submission. */
export const hasWorkerFeedbackFor = (bookingId) =>
  mockComplaints.some((c) => c.bookingId === bookingId && c.filedBy === BY_WORKER);

// ---------------------------------------------------------------------------
// AI suggestion plumbing (written by src/services/complaintAdvisor.js)
// ---------------------------------------------------------------------------

/** Complaints still needing a suggestion. The advisor drains this. */
export const getComplaintsAwaitingAi = () =>
  mockComplaints.filter((c) => c.aiStatus === AI_IDLE);

/** Marks a complaint as being worked on, so two passes cannot double-request it. */
export function markAiPending(id) {
  mockComplaints = mockComplaints.map((c) => (c.id === id ? { ...c, aiStatus: AI_PENDING } : c));
  commit();
}

/** Stores the generated suggestion, or records the failure without losing the complaint. */
export function setAiSuggestion(id, suggestion, errored = false) {
  mockComplaints = mockComplaints.map((c) =>
    c.id === id
      ? { ...c, aiSuggestion: suggestion ?? null, aiStatus: errored ? AI_ERROR : AI_DONE }
      : c,
  );
  commit();
}

/** Puts a failed suggestion back in the queue so a later attempt can retry it. */
export function resetAiSuggestion(id) {
  mockComplaints = mockComplaints.map((c) =>
    c.id === id ? { ...c, aiStatus: AI_IDLE, aiSuggestion: null } : c,
  );
  commit();
}

/** Marks a complaint resolved. Persisted, so the admin's action survives a reload. */
export function resolveComplaint(id, resolution = null) {
  mockComplaints = mockComplaints.map((c) =>
    c.id === id ? { ...c, status: 'resolved', resolvedAt: new Date().toISOString(), resolution } : c,
  );
  commit();
  return mockComplaints.find((c) => c.id === id) || null;
}

/** Subscribes a component to complaint changes. */
export function useComplaints() {
  return useSyncExternalStore(subscribeComplaints, getComplaintsVersion, getComplaintsVersion);
}
