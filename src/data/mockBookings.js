import { useSyncExternalStore } from 'react';
import { getJSON, setJSON } from '@storage/mmkv';

// Ported from e:\sahakar-seva-progress\src\data\mockBookings.js
//
// This file is the app's de facto database. Behaviour preserved exactly, including the
// module-level mutable singleton pattern (`export let mockBookings = loadStoredBookings()`
// hydrated at module-evaluation time) and the full exported API:
//   addBooking, resolveCustomerId, getBookingsByCustomer, getBookingsByWorker, getActiveBooking
//
// ONLY change from web: localStorage -> MMKV.
//   web:    localStorage.getItem('sahakar_bookings') / localStorage.setItem(...)
//   mobile: getJSON('sahakar_bookings')             / setJSON(...)
// Both are SYNCHRONOUS, which is why MMKV was chosen over AsyncStorage — the hydration below
// runs at import time, before any component renders. An async read here would mean
// `mockBookings` is empty on first render and the seed data appears to "pop in" a frame later.
// See src/storage/mmkv.js for the full rationale.
//
// NOTE on photos: BookingPage on web stores uploaded photos as base64 data URLs inside the
// booking object, which then goes into this persisted JSON and bloats it badly. On mobile the
// plan is to store file URIs instead (fixed when BookingPage is ported in Phase 7). The
// `photos` field shape is unchanged here so nothing breaks in the meantime.

const STORAGE_KEY = 'sahakar_bookings';

// The demo's service location. Single source of truth: used by the seed bookings below, as the
// fallback in addBooking, and as the migration target — so it can never drift out of sync again.
export const DEFAULT_ADDRESS = 'Heritage Institute of Technology, Chowbaga Road, Kolkata';

/**
 * Addresses from before the demo moved to Kolkata.
 *
 * WHY A MIGRATION IS NEEDED: loadStoredBookings() returns the persisted array whenever one
 * exists, which short-circuits INITIAL_BOOKINGS entirely. On any device that had already created
 * or stored a booking, editing the seed has NO effect — the old Gurugram address survives in MMKV
 * and keeps showing up (e.g. on the live-tracking sheet, which reads booking.address). So stale
 * addresses are rewritten once, on hydration, and persisted back.
 */
const LEGACY_ADDRESSES = [
  '12, Sector 45, Gurugram, Haryana',
  'Green Valley Apts, Sector 14',
];

/** True for a demo address that predates the Kolkata move. Custom user input is left untouched. */
function isLegacyAddress(addr) {
  if (typeof addr !== 'string') return false;
  return LEGACY_ADDRESSES.includes(addr.trim()) || /gurugram|haryana/i.test(addr);
}

// Initial seed bookings
const INITIAL_BOOKINGS = [
  {
    id: 'BK001',
    customerId: 'c1',
    customerName: 'Rahul Sharma',
    workerId: 'w1',
    workerName: 'Suresh Kumar',
    workerRating: 4.8,
    workerPhone: '+91 76543 21098',
    serviceId: 'plumbing',
    serviceName: 'Plumbing',
    description: 'Kitchen sink pipe is leaking badly, water dripping continuously',
    address: DEFAULT_ADDRESS,
    date: '2026-09-01',
    time: '10:00 AM',
    status: 'en-route',
    basePrice: 299,
    weatherMultiplier: 1.3,
    weatherCondition: 'Rainy',
    totalPrice: 389,
    fairnessPosition: 1,
    createdAt: '2026-08-31T14:30:00',
    rating: null,
    photos: []
  },
  {
    id: 'BK002',
    customerId: 'c1',
    customerName: 'Rahul Sharma',
    workerId: 'w2',
    workerName: 'Ramesh Yadav',
    workerRating: 4.6,
    workerPhone: '+91 65432 10987',
    serviceId: 'electrical',
    serviceName: 'Electrical',
    description: 'Multiple switches not working in bedroom',
    address: DEFAULT_ADDRESS,
    date: '2026-08-28',
    time: '2:00 PM',
    status: 'completed',
    basePrice: 349,
    weatherMultiplier: 1.0,
    weatherCondition: 'Clear',
    totalPrice: 349,
    fairnessPosition: 2,
    createdAt: '2026-08-27T09:15:00',
    rating: 5,
    photos: []
  },
  {
    id: 'BK003',
    customerId: 'c1',
    customerName: 'Rahul Sharma',
    workerId: 'w3',
    workerName: 'Meena Devi',
    workerRating: 4.9,
    workerPhone: '+91 54321 09876',
    serviceId: 'cleaning',
    serviceName: 'Cleaning',
    description: 'Full house deep cleaning needed before festival',
    address: DEFAULT_ADDRESS,
    date: '2026-08-25',
    time: '9:00 AM',
    status: 'completed',
    basePrice: 499,
    weatherMultiplier: 1.0,
    weatherCondition: 'Clear',
    totalPrice: 499,
    fairnessPosition: 1,
    createdAt: '2026-08-24T18:00:00',
    rating: 5,
    photos: []
  },
  {
    id: 'BK004',
    customerId: 'c2',
    customerName: 'Priya Patel',
    workerId: 'w4',
    workerName: 'Vikram Singh',
    workerRating: 4.5,
    workerPhone: '+91 43210 98765',
    serviceId: 'ac-repair',
    serviceName: 'AC Repair',
    description: 'AC not cooling properly, makes noise',
    address: '34, MG Road, Bengaluru, Karnataka',
    date: '2026-08-30',
    time: '11:00 AM',
    status: 'in-progress',
    basePrice: 399,
    weatherMultiplier: 1.2,
    weatherCondition: 'Hot (>40°C)',
    totalPrice: 479,
    fairnessPosition: 3,
    createdAt: '2026-08-29T16:45:00',
    rating: null,
    photos: []
  },
  {
    id: 'BK005',
    customerId: 'c1',
    customerName: 'Rahul Sharma',
    workerId: null,
    workerName: null,
    workerRating: null,
    workerPhone: null,
    serviceId: 'pest-control',
    serviceName: 'Pest Control',
    description: 'Cockroach problem in kitchen, need full treatment',
    address: DEFAULT_ADDRESS,
    date: '2026-09-03',
    time: '10:00 AM',
    status: 'cancelled',
    basePrice: 799,
    weatherMultiplier: 1.0,
    weatherCondition: 'Clear',
    totalPrice: 799,
    fairnessPosition: null,
    createdAt: '2026-08-30T12:00:00',
    rating: null,
    photos: []
  }
];

// Load persisted or default bookings
function loadStoredBookings() {
  try {
    const parsed = getJSON(STORAGE_KEY);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Rewrite any pre-Kolkata demo address, then write back so this only ever runs once.
      let changed = false;
      const migrated = parsed.map((b) => {
        if (b && isLegacyAddress(b.address)) {
          changed = true;
          return { ...b, address: DEFAULT_ADDRESS };
        }
        return b;
      });
      if (changed) {
        try {
          setJSON(STORAGE_KEY, migrated);
        } catch (e) {
          console.error('Error persisting migrated booking addresses:', e);
        }
      }
      return migrated;
    }
  } catch (e) {
    console.error('Error loading stored bookings:', e);
  }
  return [...INITIAL_BOOKINGS];
}

export let mockBookings = loadStoredBookings();

export function addBooking(bookingData) {
  // GLOBALLY UNIQUE, not just locally sequential.
  //
  // This used to be `BK00${mockBookings.length + 1}`, which was fine while bookings never left the
  // device. Once they sync through Supabase it is a data-loss bug: two devices each holding 5
  // bookings would both mint 'BK006', and the second upsert would overwrite the first person's
  // booking instead of adding one. The sequence number is kept for readability (support staff read
  // these out loud) and made unique by a base36 time slice plus two random characters.
  //
  // Safe for mockRoutes.getRouteForBooking, which does parseInt(id.replace('BK','')) — parseInt
  // stops at the first non-digit, so 'BK006-3x8ak2' still resolves to 6.
  const newId = `BK${String(mockBookings.length + 1).padStart(3, '0')}-${Date.now()
    .toString(36)
    .slice(-4)}${Math.random().toString(36).slice(2, 4)}`;
  // Resolve the customer id through the same canonicalisation used for reads.
  // This ensures a booking created by the demo customer is stored as 'c1' and
  // remains visible on any subsequent read.  Real Supabase UUIDs are unchanged.
  // We still require the caller to supply an id — never default to any seed id.
  const customerId = resolveCustomerId(bookingData.customerId);
  if (!customerId) {
    throw new Error('addBooking: customerId is required');
  }
  const newBooking = {
    id: newId,
    customerId,
    customerName: bookingData.customerName || 'Customer',
    // A brand-new booking is UNASSIGNED. Worker fields stay null until a worker accepts the job
    // in the worker portal (see acceptBooking below). Previously these defaulted to the demo
    // worker 'Suresh Kumar', which made a professional appear on the customer's confirmation
    // screen before anyone had actually taken the job.
    workerId: bookingData.workerId ?? null,
    workerName: bookingData.workerName ?? null,
    workerRating: bookingData.workerRating ?? null,
    workerPhone: bookingData.workerPhone ?? null,
    serviceId: bookingData.serviceId || 'plumbing',
    serviceName: bookingData.serviceName || 'Home Service',
    description: bookingData.description || 'Standard service request',
    address: bookingData.address || DEFAULT_ADDRESS,
    date: bookingData.date || new Date().toISOString().split('T')[0],
    time: bookingData.time || '10:00 AM',
    // 'booked' = placed, awaiting a worker to accept. It is the first step of the existing
    // statusOrder in StatusTimeline (booked -> assigned -> en-route -> in-progress -> completed),
    // so no new status value is introduced.
    status: bookingData.status || 'booked',
    basePrice: bookingData.basePrice || 299,
    weatherMultiplier: bookingData.weatherMultiplier || 1.0,
    weatherCondition: bookingData.weatherCondition || 'Clear',
    totalPrice: bookingData.totalPrice || 389,
    gst: bookingData.gst || Math.round((bookingData.totalPrice || 389) * 0.18),
    welfareCess: bookingData.welfareCess || Math.round((bookingData.totalPrice || 389) * 0.02),
    fairnessPosition: 1,
    createdAt: new Date().toISOString(),
    rating: null,
    photos: bookingData.photos || []
  };

  mockBookings.unshift(newBooking);
  commit();
  return newBooking;
}

// ---------------------------------------------------------------------------
// Demo customer ID resolution
//
// The demo customer account uses the synthetic id 'demo-customer' (injected
// by AuthContext.DEMO_ACCOUNTS for demo.customer@sahakar.in).  We canonicalise
// it to the seed customer ID 'c1' so that:
//   • reads  → demo user sees Rahul Sharma's pre-seeded bookings
//   • writes → new bookings created during a demo session are stored under 'c1'
//              and therefore remain visible on the next read
//
// Rules enforced here:
//   1. Real Supabase UUIDs pass through unchanged.
//   2. 'demo-customer' resolves to 'c1'.
//   3. null / undefined / any other falsy value → caller must handle as "no user".
//      resolveCustomerId() returns null so callers can guard explicitly.
// ---------------------------------------------------------------------------

const DEMO_CUSTOMER_ID   = 'demo-customer';
const DEMO_CUSTOMER_SEED = 'c1';

/**
 * Canonicalise a raw customer id before any read or write operation.
 * Returns null when id is absent — callers must treat null as "not authenticated".
 * Never maps an unknown or missing id to 'c1'.
 */
export function resolveCustomerId(id) {
  if (!id) return null;
  return id === DEMO_CUSTOMER_ID ? DEMO_CUSTOMER_SEED : id;
}

export const getBookingsByCustomer = (customerId) => {
  const id = resolveCustomerId(customerId);
  if (!id) return [];                                  // unauthenticated → nothing
  return mockBookings.filter(b => b.customerId === id);
};

export const getBookingsByWorker = (workerId) =>
  mockBookings.filter(b => b.workerId === workerId);

/** Look a booking up by id (live record, not a snapshot). */
export const getBookingById = (bookingId) =>
  mockBookings.find(b => b.id === bookingId);

/**
 * Bookings that are placed but not yet taken by anyone — the worker portal's job feed.
 * A booking qualifies while it is still 'booked' AND has no worker attached.
 */
export const getPendingBookings = () =>
  mockBookings.filter(b => b.status === 'booked' && !b.workerId);

/**
 * A worker accepts a pending job.
 *
 * This is the single point where a booking gains a professional. It attaches the accepting
 * worker's identity and advances the status 'booked' -> 'assigned', which is what unlocks live
 * tracking on the customer side (getActiveBooking / ACTIVE_STATUSES include 'assigned').
 *
 * A worker may hold only ONE job at a time. If they already have an active job (assigned,
 * en-route or in-progress) the acceptance is refused so they cannot pick up a second before
 * finishing the first. This is enforced here, not just in the UI, so it also holds when two
 * devices race to accept — the check runs against the same in-memory list every accept mutates.
 *
 * Returns the updated booking, or null when: the id is unknown, the job was already taken by
 * someone else, OR this worker is already on an active job. The caller distinguishes these by
 * calling getWorkerActiveJobs() before showing its message.
 */
export function acceptBooking(bookingId, worker = {}) {
  const booking = mockBookings.find(b => b.id === bookingId);
  if (!booking || booking.workerId) return null;

  // One-active-job rule — see hasActiveAcceptedJob for why it keys on acceptedAt.
  // resolveCustomerId is not involved here; workers are matched by raw id.
  const accepterId = worker.workerId ?? worker.id ?? null;
  if (accepterId && hasActiveAcceptedJob(accepterId)) return null;

  booking.workerId = accepterId;
  booking.workerName = worker.workerName ?? worker.name ?? null;
  booking.workerRating = worker.workerRating ?? worker.rating ?? null;
  booking.workerPhone = worker.workerPhone ?? worker.phone ?? null;
  booking.status = 'assigned';
  booking.acceptedAt = new Date().toISOString();

  commit();
  return booking;
}

export const getActiveBooking = (customerId) => {
  const id = resolveCustomerId(customerId);
  if (!id) return undefined;
  return mockBookings.find(
    b => b.customerId === id &&
         ['en-route', 'in-progress', 'assigned'].includes(b.status)
  );
};

// ---------------------------------------------------------------------------
// Job lifecycle: depart -> arrive -> done -> pay -> rate
//
// These drive the worker's two job-card actions and the customer's tracking/payment gates. They
// reuse the EXISTING status pipeline (booked -> assigned -> en-route -> in-progress -> completed)
// rather than inventing statuses, so every existing status colour map, filter and timeline keeps
// working:
//
//   worker taps "Leave for job"  -> assigned    -> en-route     (unlocks customer live tracking)
//   worker reaches the address   -> en-route    -> in-progress  (unlocks "Job done")
//   worker taps "Job done"       -> in-progress -> completed    (raises payment due)
//
// Payment and feedback are stored as FIELDS on the booking (paymentStatus/paidAt/paymentMethod,
// rating/feedback), not as statuses — a completed job that is unpaid is still 'completed', and
// overloading the status would break the existing history filters.
// ---------------------------------------------------------------------------

/**
 * How long the demo worker "travels" after leaving, in ms.
 *
 * The customer-facing map runs a scripted ~7-minute journey, but a demo cannot ask someone to
 * wait seven minutes to see the next step, so the worker's arrival is compressed. Arrival is
 * derived from the elapsed clock rather than requiring the customer to open the map — otherwise
 * the worker's "Job done" button could never unlock if nobody watched the tracking screen.
 */
export const DEMO_TRAVEL_MS = 25000;

// Bumped on every mutation so screens can subscribe and re-render instead of only refreshing on
// focus. Needed because the worker and customer act on the same booking from different tabs.
let bookingsVersion = 0;
const bookingListeners = new Set();

export function subscribeBookings(listener) {
  bookingListeners.add(listener);
  return () => bookingListeners.delete(listener);
}

export function getBookingsVersion() {
  return bookingsVersion;
}

function commit() {
  try {
    setJSON(STORAGE_KEY, mockBookings);
  } catch (e) {
    console.error('Error saving bookings to storage:', e);
  }
  bookingsVersion += 1;
  bookingListeners.forEach((l) => l());
}

/** Worker has set off. Only valid from 'assigned'. */
export function departForJob(bookingId) {
  const b = getBookingById(bookingId);
  if (!b || b.status !== 'assigned') return null;
  b.status = 'en-route';
  b.enRouteAt = new Date().toISOString();
  commit();
  return b;
}

/**
 * True once the worker should be considered at the customer's address. Either the tracking
 * simulation explicitly reported arrival, or enough time has passed since departure.
 */
export function hasArrived(booking, now = Date.now()) {
  if (!booking) return false;
  if (booking.arrivedAt) return true;
  if (booking.status === 'in-progress' || booking.status === 'completed') return true;
  if (!booking.enRouteAt) return false;
  return now - new Date(booking.enRouteAt).getTime() >= DEMO_TRAVEL_MS;
}

/** Registers arrival at the address. Idempotent — safe to call from the map sim repeatedly. */
export function markArrived(bookingId) {
  const b = getBookingById(bookingId);
  if (!b || b.status !== 'en-route') return null;
  b.status = 'in-progress';
  b.arrivedAt = new Date().toISOString();
  commit();
  return b;
}

/**
 * Worker marks the job finished, which raises the payment as due on the customer side.
 * `durationHours` is what gets added to the worker's weekly hours.
 */
export function completeJob(bookingId, { durationHours = 2 } = {}) {
  const b = getBookingById(bookingId);
  if (!b || !['in-progress', 'en-route'].includes(b.status)) return null;
  b.status = 'completed';
  b.completedAt = new Date().toISOString();
  b.paymentStatus = 'due';
  b.durationHours = durationHours;
  commit();
  return b;
}

/** Records a (simulated) payment against a completed job. */
export function payBooking(bookingId, { method = 'upi' } = {}) {
  const b = getBookingById(bookingId);
  if (!b) return null;
  b.paymentStatus = 'paid';
  b.paymentMethod = method;
  b.paidAt = new Date().toISOString();
  commit();
  return b;
}

/** Stores the customer's star rating and written feedback on the booking. */
export function saveBookingFeedback(bookingId, { rating = null, feedback = '' } = {}) {
  const b = getBookingById(bookingId);
  if (!b) return null;
  if (rating != null) b.rating = rating;
  if (feedback) b.feedback = feedback;
  commit();
  return b;
}

/** Completed jobs the customer still owes money on — drives the payment-due block. */
export const getUnpaidBookings = (customerId) => {
  const id = resolveCustomerId(customerId);
  if (!id) return [];
  return mockBookings.filter(
    (b) => b.customerId === id && b.status === 'completed' && b.paymentStatus === 'due',
  );
};

/**
 * Is this worker mid-job on something THEY accepted through the app?
 *
 * This is the single definition of the one-job-at-a-time rule — used by both acceptBooking (the
 * enforcement) and the job feed (the button state), so the UI and the data layer cannot disagree.
 *
 * WHY `acceptedAt` RATHER THAN JUST AN ACTIVE STATUS: the seed ships in-flight fixtures. BK001 is
 * 'en-route' for w1, which is the demo worker — so a plain "has an active job" test was true on a
 * completely fresh install, locking every Accept before the user touched anything. The customer's
 * booking then never gained a worker, so getActiveBooking() never matched it and the tracking option
 * never appeared. That was a real regression, not a theoretical one.
 *
 * `acceptedAt` is written only by acceptBooking, so it cleanly separates "a job this worker took"
 * from "a demo fixture that ships already in progress". Real workers are unaffected: every job they
 * accept sets acceptedAt, including one accepted on another device (the field syncs), so the rule
 * holds exactly as intended for them.
 *
 * Seeded fixtures still appear in getWorkerActiveJobs below, so the worker's "My jobs" list and the
 * depart -> arrive -> done demo are unchanged.
 */
export const hasActiveAcceptedJob = (workerId) =>
  !!workerId &&
  mockBookings.some(
    (b) =>
      b.workerId === workerId &&
      !!b.acceptedAt &&
      ['assigned', 'en-route', 'in-progress'].includes(b.status),
  );

/** The worker's jobs that are currently in flight — the "My jobs" list in the worker portal. */
export const getWorkerActiveJobs = (workerId) =>
  workerId
    ? mockBookings.filter(
        (b) => b.workerId === workerId && ['assigned', 'en-route', 'in-progress'].includes(b.status),
      )
    : [];

/**
 * The worker's finished AND paid jobs, newest first — these are the ones eligible for worker
 * feedback about the customer.
 *
 * Payment is part of the condition deliberately: asking a worker to rate the customer while money is
 * still outstanding invites a complaint about the non-payment rather than the experience, and the
 * unpaid case is already surfaced elsewhere.
 */
export const getWorkerPaidJobs = (workerId) =>
  workerId
    ? mockBookings
        .filter((b) => b.workerId === workerId && b.status === 'completed' && b.paymentStatus === 'paid')
        .sort((a, b) => String(b.paidAt || b.completedAt || '').localeCompare(String(a.paidAt || a.completedAt || '')))
    : [];

/**
 * Subscribes a component to booking mutations. Returns the version counter, which callers can
 * ignore — the point is the re-render. Use this wherever one portal must react to the other's
 * action (worker marks a job done -> customer's payment block appears).
 */
export function useBookings() {
  return useSyncExternalStore(subscribeBookings, getBookingsVersion, getBookingsVersion);
}
