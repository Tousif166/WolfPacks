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

  // --- e-KYC: the third verification route ---
  const kycEmail = 'kyc@example.com';
  const kycRec = api.saveWorkerRegistration(kycEmail, {
    skills: ['plumbing'],
    ekyc: {
      status: 'verified',
      aadhaarLast4: '9012',
      name: 'KYC Worker',
      occupation: 'Plumbing',
      verifiedAt: new Date().toISOString(),
      method: 'aadhaar-otp',
    },
  });
  chk('e-KYC record saved', api.isEkycVerified(kycRec));
  chk('e-KYC worker is verified immediately', kycRec.verified === true);
  chk('e-KYC worker is NOT blocked from jobs', !api.isTrainingBlocked(kycRec));
  chk('e-KYC needs no admin review (not in pending queue)', api.getPendingCertificates().every((r) => r.email !== kycEmail));
  chk('e-KYC suppresses the fresher training programme', kycRec.training === null);
  chk('e-KYC appears as a profile credential', api.registrationCertificates(kycRec).some((c) => /e-KYC/i.test(c.name)));
  chk('only the last 4 Aadhaar digits are stored', JSON.stringify(kycRec).includes('9012') && !JSON.stringify(kycRec).match(/\d{12}/));

  // e-KYC must win over a certificate still sitting in review.
  const bothEmail = 'both@example.com';
  const bothRec = api.saveWorkerRegistration(bothEmail, {
    skills: ['plumbing'],
    hasCertificate: true,
    certName: 'c.jpg',
    ekyc: { status: 'verified', aadhaarLast4: '1111', verifiedAt: new Date().toISOString(), method: 'aadhaar-otp' },
  });
  chk('e-KYC unblocks even with a pending certificate', !api.isTrainingBlocked(bothRec));

  // --- Mentorship: attribution, named modules, trainer assignment ---
  const trainerEmail = 'trainer@example.com';
  const traineeEmail = 'trainee@example.com';

  // Set up a trainer (verified) and a trainee (in-progress training)
  const trainerRec = api.saveWorkerRegistration(trainerEmail, {
    skills: ['plumbing'],
    hasCertificate: true,
    certName: 'cert.jpg',
  });
  api.approveCertificate(trainerEmail);
  const verifiedTrainer = api.getWorkerRegistration(trainerEmail);
  chk('verified worker canTrain', api.canTrain(verifiedTrainer));

  const traineeRec = api.saveWorkerRegistration(traineeEmail, {
    skills: ['plumbing'],
    wantsTraining: true,
  });
  chk('trainee appears in getTrainees()', api.getTrainees().some((t) => t.email === traineeEmail));
  chk('trainee starts unassigned', api.getUnassignedTrainees().some((t) => t.email === traineeEmail));

  // Assign the trainer
  api.assignTrainer(traineeEmail, { email: trainerEmail, name: 'Trainer Name' });
  const assigned = api.getWorkerRegistration(traineeEmail);
  chk('assignTrainer sets trainerEmail', assigned.training.trainerEmail === trainerEmail.toLowerCase());
  chk('assignTrainer sets trainerName', assigned.training.trainerName === 'Trainer Name');
  chk('trainee now in getTraineesForTrainer', api.getTraineesForTrainer(trainerEmail).some((t) => t.email === traineeEmail));
  chk('trainee no longer in getUnassignedTrainees', !api.getUnassignedTrainees().some((t) => t.email === traineeEmail));

  // trainingModules() returns the full curriculum with done/attribution
  const modules = api.trainingModules(assigned);
  chk('trainingModules returns 8 modules', modules.length === api.TRAINING_MODULES.length);
  chk('modules start undone', modules.every((m) => !m.done));

  // Mark one module done
  api.setModuleDone(traineeEmail, 0, true, { email: trainerEmail, name: 'Trainer', role: api.MARKED_BY_TRAINER });
  const afterMark = api.trainingModules(api.getWorkerRegistration(traineeEmail));
  chk('setModuleDone marks module 0 done', afterMark[0].done === true);
  chk('setModuleDone records byName', afterMark[0].byName === 'Trainer');
  chk('setModuleDone records byRole', afterMark[0].byRole === api.MARKED_BY_TRAINER);
  chk('other modules still undone', afterMark.slice(1).every((m) => !m.done));

  // Un-mark (correction)
  api.setModuleDone(traineeEmail, 0, false);
  const afterUnmark = api.trainingModules(api.getWorkerRegistration(traineeEmail));
  chk('un-marking a module removes it from the log', !afterUnmark[0].done);

  // Complete the programme with attribution
  api.setModuleDone(traineeEmail, 0, true, { email: trainerEmail, name: 'T', role: api.MARKED_BY_TRAINER });
  api.completeTraining(traineeEmail, { email: trainerEmail, name: 'T', role: api.MARKED_BY_TRAINER });
  const finished = api.getWorkerRegistration(traineeEmail);
  chk('completeTraining sets status=completed', finished.training.status === 'completed');
  chk('completeTraining fills remaining modules', api.trainingModules(finished).every((m) => m.done));
  chk('completeTraining records completedByName', finished.training.completedByName === 'T');
  chk('completeTraining records completedByRole', finished.training.completedByRole === api.MARKED_BY_TRAINER);
  chk('completed trainee is no longer in getTrainees()', !api.getTrainees().some((t) => t.email === traineeEmail));

  // A finished programme is immutable
  const beforeImmut = api.trainingModules(finished).filter((m) => m.done).length;
  api.setModuleDone(traineeEmail, 1, false);
  const afterImmut = api.trainingModules(api.getWorkerRegistration(traineeEmail)).filter((m) => m.done).length;
  chk('setModuleDone on completed programme is a no-op', beforeImmut === afterImmut);

  // Legacy record migration: a record written before per-module attribution existed has a
  // `modulesDone` COUNT but no `moduleLog`. trainingModules() is a pure function of the record it
  // is handed, so the old shape is exercised directly rather than by mutating the store (there is
  // deliberately no exported setter that can write a malformed record).
  const legacyRecord = {
    email: 'legacy@example.com',
    training: { status: 'in-progress', modulesDone: 3, startedAt: new Date().toISOString() },
  };
  const legacyModules = api.trainingModules(legacyRecord);
  chk('legacy record still yields the full curriculum', legacyModules.length === api.TRAINING_MODULES.length);
  chk('trainingModules handles legacy modulesDone', legacyModules.slice(0, 3).every((m) => m.done));
  chk('legacy modules beyond the count are undone', legacyModules.slice(3).every((m) => !m.done));
  chk('legacy completions carry no attribution', legacyModules.slice(0, 3).every((m) => !m.byName));

  // --- Job-eligibility gate: a trainee stays blocked until EVERY module is signed AND certified ---
  const gateEmail = 'gate@example.com';
  const gateRec = api.saveWorkerRegistration(gateEmail, { skills: ['plumbing'], wantsTraining: true });
  chk('fresh trainee is blocked from jobs', api.isTrainingBlocked(gateRec));

  // Partial progress must NOT unlock jobs, at any point short of the full curriculum.
  const total = api.TRAINING_MODULES.length;
  for (let i = 0; i < total - 1; i += 1) {
    api.setModuleDone(gateEmail, i, true, { email: 'x@y.z', name: 'T', role: api.MARKED_BY_TRAINER });
  }
  const partial = api.getWorkerRegistration(gateEmail);
  chk(
    `${total - 1} of ${total} modules signed -> STILL blocked`,
    api.trainingModules(partial).filter((m) => m.done).length === total - 1 && api.isTrainingBlocked(partial),
  );

  // Ticking the final module completes the checklist but does NOT issue the certificate, so the
  // worker must remain blocked — completion is a separate deliberate sign-off.
  api.setModuleDone(gateEmail, total - 1, true, { email: 'x@y.z', name: 'T', role: api.MARKED_BY_TRAINER });
  const allTicked = api.getWorkerRegistration(gateEmail);
  chk('all modules signed but no certificate -> STILL blocked', api.isTrainingBlocked(allTicked));
  chk('...and the checklist really is complete', api.trainingModules(allTicked).every((m) => m.done));

  // Only the certificate unlocks it.
  api.completeTraining(gateEmail, { email: 'x@y.z', name: 'T', role: api.MARKED_BY_TRAINER });
  const certified = api.getWorkerRegistration(gateEmail);
  chk('certified graduate is UNBLOCKED', !api.isTrainingBlocked(certified));
  chk('certified graduate has the certificate', certified.training.certificateIssued === true);

  // Fails CLOSED: an unrecognised programme status must not read as employable.
  chk(
    'unknown training status fails closed (blocked)',
    api.isTrainingBlocked({ email: 'odd@example.com', training: { status: 'paused', modulesDone: 0 } }),
  );
  chk(
    'missing training status fails closed (blocked)',
    api.isTrainingBlocked({ email: 'odd2@example.com', training: { modulesDone: 2 } }),
  );
  // A certificate flag alone must not unlock an incomplete checklist.
  chk(
    'certificate flag with unsigned modules stays blocked',
    api.isTrainingBlocked({ email: 'odd3@example.com', training: { status: 'completed', modulesDone: 2, certificateIssued: true } }),
  );

  // Unchanged exemptions: no record, e-KYC, approved certificate.
  chk('worker with NO record is not blocked', !api.isTrainingBlocked(null));

  // A blocked trainee also cannot act as a trainer, and is excluded from the skill supply counts.
  chk('blocked trainee cannot train others', !api.canTrain(api.getWorkerRegistration('gate2@example.com') || partial));

  // --- CERTIFICATE REJECTED AS UNQUALIFIED -> shifts into training mode ---
  // A distinct state shape from a plain fresher: certificate.status is 'rejected' (not 'pending' or
  // absent) AND a fresh programme is attached. Worth asserting separately because the earlier
  // isTrainingBlocked branches short-circuit on certificate state, so a mistake in their ordering
  // could let this record fall through as employable.
  const rejEmail = 'rejected.into.training@example.com';
  api.saveWorkerRegistration(rejEmail, { skills: ['plumbing'], hasCertificate: true, certName: 'cert.jpg' });
  chk('uploaded certificate starts blocked (pending review)', api.isTrainingBlocked(api.getWorkerRegistration(rejEmail)));

  api.rejectCertificateAsUnqualified(rejEmail);
  const rej = api.getWorkerRegistration(rejEmail);
  chk('rejected-unqualified: certificate marked rejected', rej.certificate.status === 'rejected' && rej.certificate.reason === api.REJECT_UNQUALIFIED);
  chk('rejected-unqualified: NOT banned', rej.banned === false);
  chk('rejected-unqualified: enrolled in a fresh programme', rej.training?.status === 'in-progress');
  chk('rejected-unqualified: record.verified is false', rej.verified === false);
  chk('rejected-unqualified: STILL BLOCKED from jobs', api.isTrainingBlocked(rej));
  chk('rejected-unqualified: no modules signed yet', api.trainingModules(rej).every((m) => !m.done));
  // The rejected certificate must NOT appear as a profile credential — it is not proof of anything.
  chk('rejected certificate is not listed as a credential', api.registrationCertificates(rej).length === 0);
  chk('rejected-unqualified: cannot train others', !api.canTrain(rej));

  // ...and after the programme is signed off they become verified and employable.
  for (let i = 0; i < api.TRAINING_MODULES.length; i += 1) {
    api.setModuleDone(rejEmail, i, true, { email: 'tr@x.z', name: 'Trainer', role: api.MARKED_BY_TRAINER });
  }
  api.completeTraining(rejEmail, { email: 'tr@x.z', name: 'Trainer', role: api.MARKED_BY_TRAINER });
  const rejDone = api.getWorkerRegistration(rejEmail);
  chk('rejected-then-trained: UNBLOCKED after sign-off', !api.isTrainingBlocked(rejDone));
  chk('rejected-then-trained: record.verified flips true', rejDone.verified === true);
  chk('rejected-then-trained: training certificate issued as a credential', api.registrationCertificates(rejDone).some((c) => /Training Certificate/.test(c.name)));

  // --- AWAITING TRAINER ASSIGNMENT must never be employable, and an UNSUPERVISED programme
  //     must not confer verification even if the certificate flag is set. ---
  const awaitEmail = 'awaiting.trainer@example.com';
  api.saveWorkerRegistration(awaitEmail, { skills: ['plumbing'], wantsTraining: true });
  const awaiting = api.getWorkerRegistration(awaitEmail);
  chk('awaiting trainer: no trainer assigned', !awaiting.training.trainerEmail);
  chk('awaiting trainer: BLOCKED from jobs', api.isTrainingBlocked(awaiting));
  chk('awaiting trainer: appears in the unassigned queue', api.getUnassignedTrainees().some((r) => r.email === awaitEmail));

  // Signed off by NOBODY — no trainer, no attribution. This is the self-certified shape and it must
  // stay blocked despite certificateIssued being true.
  const unsupEmail = 'unsupervised@example.com';
  api.saveWorkerRegistration(unsupEmail, { skills: ['plumbing'], wantsTraining: true });
  api.completeTraining(unsupEmail); // no `by` -> no attribution at all
  const unsup = api.getWorkerRegistration(unsupEmail);
  chk('unsupervised programme: certificate flag IS set', unsup.training.certificateIssued === true);
  chk('unsupervised programme: every module marked done', api.trainingModules(unsup).every((m) => m.done));
  chk('unsupervised programme: has no trainer and no sign-off', !unsup.training.trainerEmail && !unsup.training.completedByRole);
  chk('unsupervised programme: STILL BLOCKED (no self-certification)', api.isTrainingBlocked(unsup));
  chk('unsupervised programme: cannot train others either', !api.canTrain(unsup));

  // Admin offline sign-off — no trainer, but real attribution. Must be allowed through.
  const adminSignEmail = 'admin.signed@example.com';
  api.saveWorkerRegistration(adminSignEmail, { skills: ['plumbing'], wantsTraining: true });
  api.completeTraining(adminSignEmail, { email: 'adm@x.z', name: 'Admin', role: api.MARKED_BY_ADMIN });
  const adminSigned = api.getWorkerRegistration(adminSignEmail);
  chk('admin offline sign-off (no trainer, has attribution): UNBLOCKED', !api.isTrainingBlocked(adminSigned));
  chk('admin offline sign-off: attribution recorded', adminSigned.training.completedByRole === api.MARKED_BY_ADMIN);

  // Normal peer-mentorship route stays unblocked.
  const mentoredEmail = 'mentored@example.com';
  api.saveWorkerRegistration(mentoredEmail, { skills: ['plumbing'], wantsTraining: true });
  api.assignTrainer(mentoredEmail, { email: 'tr@x.z', name: 'Trainer Bob' });
  api.completeTraining(mentoredEmail, { email: 'tr@x.z', name: 'Trainer Bob', role: api.MARKED_BY_TRAINER });
  chk('trainer-mentored graduate: UNBLOCKED', !api.isTrainingBlocked(api.getWorkerRegistration(mentoredEmail)));

  // --- SELF-CERTIFICATION MUST BE IMPOSSIBLE ---
  // Observed in the field: a trainee appeared as their own trainer ("Your trainer: <own name>") with
  // modules signed by themselves, because the worker Training tab listed an unassigned pool that
  // included the viewer. All three write paths now refuse it, and the read path rejects records
  // already corrupted before the guards existed.
  const selfEmail = 'self.certifier@example.com';
  api.saveWorkerRegistration(selfEmail, { skills: ['plumbing'], wantsTraining: true });

  chk(
    'assignTrainer REFUSES self-assignment',
    api.assignTrainer(selfEmail, { email: selfEmail, name: 'Self' }) === null,
  );
  chk('...trainer left unassigned', !api.getWorkerRegistration(selfEmail).training.trainerEmail);
  chk(
    'assignTrainer refuses self-assignment regardless of case',
    api.assignTrainer(selfEmail, { email: 'Self.Certifier@Example.COM', name: 'Self' }) === null,
  );

  chk(
    'setModuleDone REFUSES a trainee signing their own module',
    api.setModuleDone(selfEmail, 0, true, { email: selfEmail, name: 'Self', role: api.MARKED_BY_TRAINER }) === null,
  );
  chk('...module stayed unsigned', !api.trainingModules(api.getWorkerRegistration(selfEmail))[0].done);

  chk(
    'completeTraining REFUSES self sign-off',
    api.completeTraining(selfEmail, { email: selfEmail, name: 'Self', role: api.MARKED_BY_TRAINER }) === null,
  );
  chk('...no certificate issued', !api.getWorkerRegistration(selfEmail).training.certificateIssued);
  chk('...still blocked from jobs', api.isTrainingBlocked(api.getWorkerRegistration(selfEmail)));

  // A legitimate trainer can still do all three for the same trainee.
  chk('a DIFFERENT trainer can be assigned', !!api.assignTrainer(selfEmail, { email: 'realtrainer@example.com', name: 'Real Trainer' }));
  chk(
    'a different trainer can sign a module',
    !!api.setModuleDone(selfEmail, 0, true, { email: 'realtrainer@example.com', name: 'Real Trainer', role: api.MARKED_BY_TRAINER }),
  );

  // Read-path defence: a record persisted BEFORE the guards, whose trainer is the trainee.
  chk(
    'pre-existing self-trained record is treated as unsupervised (blocked)',
    api.isTrainingBlocked({
      email: 'legacy.self@example.com',
      training: {
        status: 'completed',
        modulesDone: 8,
        certificateIssued: true,
        trainerEmail: 'legacy.self@example.com',
        trainerName: 'Legacy Self',
        completedByName: 'Legacy Self',
      },
    }),
  );
  chk(
    'the same record with a DIFFERENT trainer is fine',
    !api.isTrainingBlocked({
      email: 'legacy.ok@example.com',
      training: {
        status: 'completed',
        modulesDone: 8,
        certificateIssued: true,
        trainerEmail: 'someone.else@example.com',
        trainerName: 'Someone Else',
        completedByName: 'Someone Else',
      },
    }),
  );

}

// ---------------------------------------------------------------------------
console.log('');
console.log('=== TRAINING GATE enforced in the data layer (bookings x registration) ===');
{
  // A genuine cross-store test: the REAL workerRegistration functions are injected as the shims for
  // mockBookings' new import, rather than fakes. So this exercises the same code path the app runs.
  //
  // This matters because acceptBooking only calls into the registration store when an email is
  // supplied — with no email the stripped import is never reached and the gate would silently go
  // untested while appearing to pass.
  const regMod = loadStore('src/data/workerRegistration.js');
  const { api } = loadStore('src/data/mockBookings.js', {
    getWorkerRegistration: regMod.api.getWorkerRegistration,
    isTrainingBlocked: regMod.api.isTrainingBlocked,
  });

  const newJob = (id) =>
    api.addBooking({
      customerId: 'c1',
      customerName: 'C',
      serviceId: 'plumbing',
      serviceName: 'Plumbing',
      description: id,
      address: 'a',
      date: '2026-09-25',
      time: '10:00 AM',
      totalPrice: 400,
    });

  // --- A worker MID-TRAINING is refused by the store itself ---
  const traineeEmail = 'gate.trainee@example.com';
  regMod.api.saveWorkerRegistration(traineeEmail, { skills: ['plumbing'], wantsTraining: true });
  chk(
    'precondition: trainee is training-blocked',
    regMod.api.isTrainingBlocked(regMod.api.getWorkerRegistration(traineeEmail)),
  );

  const jobA = newJob('for-trainee');
  const refused = api.acceptBooking(jobA.id, { workerId: 'wT', workerName: 'Trainee', workerEmail: traineeEmail });
  chk('acceptBooking REFUSES a worker in training', refused === null);
  chk('...booking left unassigned', api.getBookingById(jobA.id).workerId === null);
  chk('...booking still "booked"', api.getBookingById(jobA.id).status === 'booked');
  chk('...and still visible in the pending feed', api.getPendingBookings().some((b) => b.id === jobA.id));

  // Partial progress must not open the gate either.
  for (let i = 0; i < regMod.api.TRAINING_MODULES.length - 1; i += 1) {
    regMod.api.setModuleDone(traineeEmail, i, true, { email: 'x@y.z', name: 'T', role: regMod.api.MARKED_BY_TRAINER });
  }
  const stillRefused = api.acceptBooking(jobA.id, { workerId: 'wT', workerName: 'Trainee', workerEmail: traineeEmail });
  chk('acceptBooking still refuses with 7 of 8 modules signed', stillRefused === null);

  // --- Once CERTIFIED the same worker is allowed through ---
  regMod.api.completeTraining(traineeEmail, { email: 'x@y.z', name: 'T', role: regMod.api.MARKED_BY_TRAINER });
  chk(
    'precondition: graduate is no longer blocked',
    !regMod.api.isTrainingBlocked(regMod.api.getWorkerRegistration(traineeEmail)),
  );
  chk('completeTraining flips record.verified to true', regMod.api.getWorkerRegistration(traineeEmail).verified === true);

  const accepted = api.acceptBooking(jobA.id, { workerId: 'wT', workerName: 'Trainee', workerEmail: traineeEmail });
  chk('CERTIFIED worker CAN accept', accepted !== null);
  chk('...booking assigned to them', api.getBookingById(jobA.id).workerId === 'wT');
  chk('...status advanced to assigned', api.getBookingById(jobA.id).status === 'assigned');

  // --- A banned/unqualified trainee routed into training is refused ---
  const unqEmail = 'gate.unqualified@example.com';
  regMod.api.saveWorkerRegistration(unqEmail, { skills: ['plumbing'], hasCertificate: true, certName: 'c.jpg' });
  regMod.api.rejectCertificateAsUnqualified(unqEmail);
  const jobB = newJob('for-unqualified');
  chk(
    'certificate declined as unqualified -> refused by the store',
    api.acceptBooking(jobB.id, { workerId: 'wU', workerName: 'U', workerEmail: unqEmail }) === null,
  );

  // --- A worker whose certificate is still PENDING review is refused ---
  const pendEmail = 'gate.pending@example.com';
  regMod.api.saveWorkerRegistration(pendEmail, { skills: ['plumbing'], hasCertificate: true, certName: 'p.jpg' });
  const jobC = newJob('for-pending');
  chk(
    'certificate pending review -> refused by the store',
    api.acceptBooking(jobC.id, { workerId: 'wP', workerName: 'P', workerEmail: pendEmail }) === null,
  );
  // ...and allowed once approved.
  regMod.api.approveCertificate(pendEmail);
  chk('...allowed once the certificate is approved', api.acceptBooking(jobC.id, { workerId: 'wP', workerName: 'P', workerEmail: pendEmail }) !== null);

  // --- e-KYC worker is allowed straight away ---
  const kycEmail = 'gate.kyc@example.com';
  regMod.api.saveWorkerRegistration(kycEmail, {
    skills: ['plumbing'],
    ekyc: { status: 'verified', aadhaarLast4: '4321', verifiedAt: new Date().toISOString(), method: 'aadhaar-otp' },
  });
  const jobD = newJob('for-kyc');
  chk('e-KYC worker is allowed to accept', api.acceptBooking(jobD.id, { workerId: 'wK', workerName: 'K', workerEmail: kycEmail }) !== null);

  // --- BACKWARD COMPATIBILITY: no email supplied must still work (demo worker + node scripts) ---
  const jobE = newJob('no-email');
  chk(
    'no email supplied -> still allowed (demo worker / scripts unaffected)',
    api.acceptBooking(jobE.id, { workerId: 'wNoEmail', workerName: 'Demo' }) !== null,
  );
  const jobF = newJob('unknown-email');
  chk(
    'unknown email (no record) -> allowed, per the documented exemption',
    api.acceptBooking(jobF.id, { workerId: 'wUnknown', workerName: 'X', workerEmail: 'nobody@example.com' }) !== null,
  );

  // --- THE REPORTED BUG: enrolled in Supabase, NO local record on this device ---
  // buildWorkerData resolves worker_profiles.training_requested into `trainingBlocked`; the store
  // must refuse on that flag alone, because its own lookup finds nothing for this email.
  const jobG = newJob('remote-only-trainee');
  chk(
    'remote-only trainee (no local record) -> REFUSED via trainingBlocked flag',
    api.acceptBooking(jobG.id, {
      workerId: 'wRemote',
      workerName: 'Remote Trainee',
      workerEmail: 'remote.trainee@example.com',
      trainingBlocked: true,
    }) === null,
  );
  chk('...booking left unassigned', api.getBookingById(jobG.id).workerId === null);
  chk(
    '...and the same worker is allowed once no longer blocked',
    api.acceptBooking(jobG.id, {
      workerId: 'wRemote',
      workerName: 'Remote Trainee',
      workerEmail: 'remote.trainee@example.com',
      trainingBlocked: false,
    }) !== null,
  );
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
