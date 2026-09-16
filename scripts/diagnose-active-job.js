/**
 * Diagnoses the reported regression: after adding the one-active-job rule, a worker can no longer
 * accept a job, so the customer never gets an assigned worker and the tracking option never appears.
 *
 * Hypothesis: the SEED data already gives worker 'w1' (the demo worker) an active booking — BK001 is
 * seeded with status 'en-route'. getWorkerActiveJobs('w1') therefore returns a job on a completely
 * fresh install, hasActiveJob is true, and every Accept is locked from the very first launch.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

function loadStore(rel) {
  const raw = fs.readFileSync(path.join(REPO, rel), 'utf8');
  const body = raw
    .replace(/^import[^;]*;$/gm, '')
    .replace(/^export let /gm, 'let ')
    .replace(/^export const /gm, 'const ')
    .replace(/^export function /gm, 'function ')
    .replace(/^export \{[^}]*\};$/gm, '');
  const store = new Map();
  const shims = {
    getJSON: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
    setJSON: (k, v) => store.set(k, JSON.stringify(v)),
    useSyncExternalStore: () => 0,
    mockServices: [],
    mockWorkers: [],
  };
  const exported = [...raw.matchAll(/^export (?:let|const|function) (\w+)/gm)].map((m) => m[1]);
  // eslint-disable-next-line no-new-func
  const factory = new Function(...Object.keys(shims), `${body}\nreturn { ${exported.join(', ')} };`);
  return factory(...Object.values(shims));
}

const api = loadStore('src/data/mockBookings.js');

console.log('=== SEED BOOKINGS (fresh install, nothing persisted) ===');
api.mockBookings.forEach((b) => {
  console.log(
    `  ${b.id.padEnd(10)} worker=${String(b.workerId).padEnd(6)} customer=${String(b.customerId).padEnd(4)} status=${b.status}`,
  );
});

console.log('');
console.log('=== ACTIVE JOBS PER SEEDED WORKER (what blocks Accept) ===');
['w1', 'w2', 'w3', 'w4', 'w5'].forEach((w) => {
  const active = api.getWorkerActiveJobs(w);
  const blocked = active.length > 0;
  console.log(
    `  ${w}: ${active.length} active ${blocked ? '-> ACCEPT IS LOCKED' : '-> can accept'}` +
      (blocked ? `  (${active.map((b) => `${b.id}/${b.status}`).join(', ')})` : ''),
  );
});

console.log('');
console.log('=== THE DEMO WORKER ===');
console.log("  workerData.buildWorkerData maps user 'demo-worker' -> mockWorkerId 'w1'");
const w1Active = api.getWorkerActiveJobs('w1');
console.log(`  getWorkerActiveJobs('w1') -> ${w1Active.length} job(s)`);
console.log('');
console.log('  seeded active jobs for w1     : ' + w1Active.length + '  (shown in "My jobs" — correct)');
console.log('  hasActiveAcceptedJob(w1)      : ' + api.hasActiveAcceptedJob('w1'));
console.log('');
if (api.hasActiveAcceptedJob('w1')) {
  console.log('  *** REGRESSION PRESENT: the seeded fixture is blocking Accept on a fresh');
  console.log('      install, so a customer booking can never gain a worker and the');
  console.log('      tracking option never appears.');
} else {
  console.log('  OK: the seeded fixture does NOT block Accept (it has no acceptedAt), so a');
  console.log('      fresh install can take a job. The rule still applies to jobs actually');
  console.log('      accepted through the app — proven below.');
}

// Prove the downstream effect end to end.
console.log('');
console.log('=== END-TO-END REPRODUCTION ===');
const fresh = api.addBooking({
  customerId: 'c1',
  customerName: 'Rahul Sharma',
  serviceId: 'plumbing',
  serviceName: 'Plumbing',
  description: 'new job',
  address: 'addr',
  date: '2026-09-22',
  time: '10:00 AM',
  totalPrice: 300,
});
console.log(`  customer places booking ${fresh.id} (status=${fresh.status}, worker=${fresh.workerId})`);

const accepted = api.acceptBooking(fresh.id, { workerId: 'w1', workerName: 'Suresh Kumar' });
console.log(`  demo worker w1 taps Accept -> ${accepted === null ? 'REFUSED (null)' : 'accepted'}`);

const afterAccept = api.getBookingById(fresh.id);
console.log(`  booking is now status=${afterAccept.status}, worker=${afterAccept.workerId}`);

const active = api.getActiveBooking('c1');
console.log(
  `  customer getActiveBooking('c1') -> ${active ? active.id + ' (' + active.status + ')' : 'undefined'}`,
);
console.log(
  `  does the customer see a tracking option for ${fresh.id}? ` +
    `${active && active.id === fresh.id ? 'YES' : 'NO  <-- the reported bug'}`,
);

// The rule must still bite once a job HAS been accepted through the app.
console.log('');
console.log('=== THE RULE STILL APPLIES TO REAL ACCEPTS ===');
const second = api.addBooking({
  customerId: 'c1',
  customerName: 'Rahul Sharma',
  serviceId: 'plumbing',
  serviceName: 'Plumbing',
  description: 'second job',
  address: 'addr',
  date: '2026-09-23',
  time: '11:00 AM',
  totalPrice: 300,
});
const secondTry = api.acceptBooking(second.id, { workerId: 'w1', workerName: 'Suresh Kumar' });
console.log(`  w1 (now mid-job) taps Accept on ${second.id} -> ${secondTry === null ? 'REFUSED (correct)' : '*** ALLOWED - rule broken'}`);

// ...and lifts once that job is finished.
api.departForJob(fresh.id);
api.markArrived(fresh.id);
api.completeJob(fresh.id, {});
const thirdTry = api.acceptBooking(second.id, { workerId: 'w1', workerName: 'Suresh Kumar' });
console.log(`  after finishing, Accept on ${second.id} -> ${thirdTry ? 'allowed (correct)' : '*** still refused'}`);

const ok =
  !api.hasActiveAcceptedJob('w2') &&
  active &&
  active.id === fresh.id &&
  secondTry === null &&
  !!thirdTry;
console.log('');
console.log(ok ? 'ALL ONE-JOB-RULE BEHAVIOUR CORRECT' : 'SOMETHING IS WRONG');
process.exit(ok ? 0 : 1);
