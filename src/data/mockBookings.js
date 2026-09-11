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
  const newId = `BK00${mockBookings.length + 1}`;
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
  try {
    setJSON(STORAGE_KEY, mockBookings);
  } catch (e) {
    console.error('Error saving booking to storage:', e);
  }
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
 * Returns the updated booking, or null when the id is unknown or the job was already taken
 * (so the caller can tell the worker someone else got there first).
 */
export function acceptBooking(bookingId, worker = {}) {
  const booking = mockBookings.find(b => b.id === bookingId);
  if (!booking || booking.workerId) return null;

  booking.workerId = worker.workerId ?? worker.id ?? null;
  booking.workerName = worker.workerName ?? worker.name ?? null;
  booking.workerRating = worker.workerRating ?? worker.rating ?? null;
  booking.workerPhone = worker.workerPhone ?? worker.phone ?? null;
  booking.status = 'assigned';
  booking.acceptedAt = new Date().toISOString();

  try {
    setJSON(STORAGE_KEY, mockBookings);
  } catch (e) {
    console.error('Error saving accepted booking to storage:', e);
  }
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
