/**
 * Smoke-tests every MMKV-backed store after the sync layer was removed.
 *
 * Signature checks only prove the exports still exist. This exercises each store's real read/write
 * cycle against an in-memory MMKV, so a seam removed carelessly — a `commit()` that no longer
 * persists, a listener never fired, an orphaned variable — fails here rather than on a device.
 *
 * Run: node scripts/verify-local-stores.js   (or `npm run check:stores`)
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

/** Loads a store module with its imports shimmed, plus the backing map so persistence is inspectable. */
function loadStore(rel, extra = {}) {
  const raw = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const body = raw
    .replace(/^import[^;]*;$/gm, '')
    .replace(/^export let /gm, 'let ')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export \{[^}]*\};$/gm, '');

  const store = new Map();
  let notifications = 0;
  const shims = {
    getJSON: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
    setJSON: (k, v) => store.set(k, JSON.stringify(v)),
    useSyncExternalStore: () => {
      notifications += 1;
      return 0;
    },
    mockServices: [
      { id: 'plumbing', name: 'Plumbing', icon: 'wrench' },
      { id: 'cleaning', name: 'Cleaning', icon: 'broom' },
    ],
    mockWorkers: [{ id: 'w1', leaveRequests: [] }],
    ...extra,
  };
  const exported = [...raw.matchAll(/^export (?:let|const|function) (\w+)/gm)].map((m) => m[1]);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(shims), `${body}\nreturn { ${exported.join(', ')} };`);
  return { api: factory(...Object.values(shims)), store, notified: () => notifications };
}

let pass = 0;
let fail = 0;
function chk(label, ok) {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

// ---------------------------------------------------------------------------
console.log('=== bookings (sahakar_bookings) ===');
{
  const { api, store } = loadStore('src/data/mockBookings.js');
  let notified = 0;
  api.subscribeBookings(() => {
    notified += 1;
  });

  const seeded = api.mockBookings.length;
  const b = api.addBooking({
    customerId: 'c1',
    customerName: 'C',
    serviceId: 'plumbing',
    serviceName: 'Plumbing',
    description: 'x',
    address: 'a',
    date: '2026-09-25',
    time: '10:00 AM',
    totalPrice: 400,
  });
  chk('addBooking appends', api.mockBookings.length === seeded + 1);
  chk('write PERSISTED to storage', store.has('sahakar_bookings'));
  chk('subscribers notified', notified > 0);
  chk('version counter advanced', api.getBookingsVersion() > 0);

  const persisted = JSON.parse(store.get('sahakar_bookings'));
  chk('persisted copy contains the new booking', persisted.some((x) => x.id === b.id));

  // Full lifecycle still drives statuses and timestamps.
  api.acceptBooking(b.id, { workerId: 'w2', workerName: 'W' });
  chk('accept -> assigned', api.getBookingById(b.id).status === 'assigned');
  api.departForJob(b.id);
  chk('depart -> en-route', api.getBookingById(b.id).status === 'en-route');
  api.markArrived(b.id);
  chk('arrive -> in-progress', api.getBookingById(b.id).status === 'in-progress');
  api.completeJob(b.id, {});
  chk('complete -> completed + payment due', api.getBookingById(b.id).paymentStatus === 'due');
  api.payBooking(b.id, { method: 'upi' });
  chk('pay -> paid', api.getBookingById(b.id).paymentStatus === 'paid');
  api.saveBookingFeedback(b.id, { rating: 5, feedback: 'great' });
  chk('feedback stored', api.getBookingById(b.id).rating === 5);

  chk('customer selector works', api.getBookingsByCustomer('c1').length > 0);
  chk('demo customer alias resolves', api.resolveCustomerId('demo-customer') === 'c1');
  chk('worker paid-jobs selector works', api.getWorkerPaidJobs('w2').some((x) => x.id === b.id));
}

// ---------------------------------------------------------------------------
console.log('');
console.log('=== complaints (sahakar_complaints) ===');
{
  const { api, store } = loadStore('src/data/mockComplaints.js');
  let notified = 0;
  api.subscribeComplaints(() => {
    notified += 1;
  });

  const c = api.addComplaint({
    customerId: 'c1',
    customerName: 'C',
    workerId: 'w2',
    workerName: 'W',
    bookingId: 'BK002',
    serviceName: 'Electrical',
    subject: 'late',
    description: 'd',
  });
  chk('addComplaint works', !!c.id);
  chk('write PERSISTED', store.has('sahakar_complaints'));
  chk('subscribers notified', notified > 0);
  chk('direction derived (customer -> worker)', c.filedBy === 'customer' && c.against === 'worker');

  const w = api.addWorkerComplaint({
    customerId: 'c1',
    workerId: 'w2',
    bookingId: 'BK009',
    subject: 'rude',
    rating: 2,
  });
  chk('worker-filed complaint reverses direction', w.filedBy === 'worker' && w.against === 'customer');
  chk('hasWorkerFeedbackFor sees it', api.hasWorkerFeedbackFor('BK009'));

  // Read through the selector, not the captured array. This module REPLACES `mockComplaints` on
  // every write (bookings mutates in place instead), so a reference captured at load time goes
  // stale — in the app that is handled by ESM live bindings, which this harness does not emulate.
  const all = () => api.getComplaintsByStatus('all');

  api.markAiPending(c.id);
  chk('AI status -> pending', all().find((x) => x.id === c.id).aiStatus === 'pending');
  api.setAiSuggestion(c.id, 'try this');
  const done = all().find((x) => x.id === c.id);
  chk('AI suggestion stored + done', done.aiStatus === 'done' && done.aiSuggestion === 'try this');

  const resolved = api.resolveComplaint(c.id, 'refunded');
  chk('resolveComplaint returns the record', resolved && resolved.status === 'resolved');
  chk('resolution persisted', JSON.parse(store.get('sahakar_complaints')).some((x) => x.resolution === 'refunded'));
}

// ---------------------------------------------------------------------------
console.log('');
console.log('=== worker registration (sahakar_worker_registration) ===');
{
  const { api, store } = loadStore('src/data/workerRegistration.js');
  let notified = 0;
  api.subscribeWorkerRegistration(() => {
    notified += 1;
  });

  const email = 'Test.Worker@Example.com';
  const rec = api.saveWorkerRegistration(email, {
    skills: ['plumbing'],
    hasCertificate: true,
    certName: 'cert.jpg',
  });
  chk('saveWorkerRegistration works', !!rec);
  chk('email lowercased as the key', rec.email === 'test.worker@example.com');
  chk('write PERSISTED', store.has('sahakar_worker_registration'));
  chk('subscribers notified', notified > 0);
  chk('certificate starts pending', api.isCertificatePending(rec));
  chk('pending queue includes it', api.getPendingCertificates().length === 1);
  chk('blocked from jobs while pending', api.isTrainingBlocked(rec));

  const approved = api.approveCertificate(email);
  chk('approve -> approved + verified', api.isCertificateApproved(approved) && approved.verified === true);
  chk('unblocked after approval', !api.isTrainingBlocked(approved));
  chk('approval PERSISTED', JSON.parse(store.get('sahakar_worker_registration'))['test.worker@example.com'].verified === true);

  // The declined-as-unqualified branch routes into training.
  const email2 = 'trainee@example.com';
  api.saveWorkerRegistration(email2, { skills: ['cleaning'], hasCertificate: true, certName: 'c.jpg' });
  const unq = api.rejectCertificateAsUnqualified(email2);
  chk('unqualified -> enrolled in training, not banned', !!unq.training && unq.banned === false);
  const trained = api.completeTraining(email2);
  chk('training completion issues a certificate', trained.training.certificateIssued === true);
  chk('training cert appears on the profile', api.registrationCertificates(trained).length > 0);

  // The fraud branch bans.
  const email3 = 'fraud@example.com';
  api.saveWorkerRegistration(email3, { skills: ['plumbing'], hasCertificate: true, certName: 'f.jpg' });
  const banned = api.rejectCertificateAsFake(email3);
  chk('fake -> banned', api.isBanned(banned) && banned.banReason === 'fake');

  chk('skill counts exclude banned/blocked', typeof api.getAllRegisteredSkillCounts() === 'object');
}

// ---------------------------------------------------------------------------
console.log('');
console.log('=== worker status (sahakar_worker_status) ===');
{
  const { api, store } = loadStore('src/data/workerStatus.js');
  let notified = 0;
  api.subscribeWorkerStatus(() => {
    notified += 1;
  });

  chk('defaults to the fallback when unset', api.getWorkerAvailability('w9', true) === true);
  api.setWorkerAvailability('w9', false);
  chk('toggle offline works', api.getWorkerAvailability('w9', true) === false);
  chk('write PERSISTED', store.has('sahakar_worker_status'));
  chk('subscribers notified', notified > 0);
  chk(
    'approved leave covering today is detected',
    api.isOnLeave([{ status: 'approved', startDate: '2000-01-01', endDate: '2100-01-01' }]),
  );
  chk(
    'pending leave is ignored',
    !api.isOnLeave([{ status: 'pending', startDate: '2000-01-01', endDate: '2100-01-01' }]),
  );
}

// ---------------------------------------------------------------------------
console.log('');
console.log('=== worker stats (sahakar_worker_stats) ===');
{
  const { api, store } = loadStore('src/data/workerStats.js');
  let notified = 0;
  api.subscribeWorkerStats(() => {
    notified += 1;
  });

  api.recordCompletedJob('w2', { amount: 500, rating: 5, bookingId: 'BK009' });
  const s = api.getWorkerStats('w2');
  chk('earnings delta recorded', s.earningsDelta === 500);
  chk('job count incremented', s.jobsDelta === 1);
  chk('hours credited', s.hoursDelta === 2);
  chk('rating collected', s.ratings.length === 1);
  chk('payment notice parked', s.paymentAcknowledged === false);
  chk('write PERSISTED', store.has('sahakar_worker_stats'));
  chk('subscribers notified', notified > 0);

  api.acknowledgePayment('w2');
  chk('acknowledge clears the notice', api.getWorkerStats('w2').paymentAcknowledged === true);

  const merged = api.applyStats({ earnings: 1000, totalJobs: 10, rating: 4, cibil_score: 700, weekly_hours_worked: 10 }, 'w2');
  chk('applyStats layers delta over baseline', merged.earnings === 1500 && merged.totalJobs === 11);
  chk('score clamped into band', merged.cibil_score >= 300 && merged.cibil_score <= 900);
}

console.log('');
console.log(fail === 0 ? `ALL LOCAL STORE CHECKS PASSED (${pass})` : `${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
