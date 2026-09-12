import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal as RNModalNative,
  View,
  Text,
  Pressable,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Alert,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MapPin,
  Clock,
  IndianRupee,
  User,
  CheckCircle,
  XCircle,
  Scale,
  ChevronDown,
  Star,
  Wrench,
  Droplet,
  Zap,
  SprayCan,
  Hammer,
  Wind,
  Settings,
  X,
  Wallet,
  Check,
  Lightbulb,
  PowerOff,
  CalendarOff,
  GraduationCap,
  Filter,
  Navigation2,
  FileClock,
  MessageSquare,
  MessageSquareWarning,
  ChevronRight,
  Map as MapIcon,
} from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenContainer, Confetti, ComplaintAgainstYouCard } from '@components/app';
import { useLanguage } from '@context/LanguageContext';
import { useAuth } from '@context/AuthContext';
import {
  getPendingBookings,
  acceptBooking,
  getWorkerActiveJobs,
  hasActiveAcceptedJob,
  getWorkerPaidJobs,
  departForJob,
  markArrived,
  completeJob,
  hasArrived,
  useBookings,
} from '@data/mockBookings';
import {
  addWorkerComplaint,
  getComplaintsAgainstWorker,
  hasWorkerFeedbackFor,
  useComplaints,
} from '@data/mockComplaints';
import { scheduleAdvisor } from '@services/complaintAdvisor';
import { useWorkerStatus } from '@data/workerStatus';
import { useWorkerRegistration } from '@data/workerRegistration';
import { useWorkerStats, WEEKLY_HOUR_CAP } from '@data/workerStats';
import { buildWorkerData } from './workerData';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * JobFeedScreen — ported from web pages/worker/JobFeed.jsx. Available jobs sorted by fairness
 * queue, urgency badges, accept flow (confirm modal → accepted overlay → timed removal after
 * 1.5s). Job data + handleAccept setTimeout behaviour preserved verbatim.
 *
 * VISUAL REDESIGN (frontend-only — no data, handlers, navigation, or business logic changed):
 *  - Premium page header ("Available Jobs" + dynamic "{n} jobs available near you" subtitle
 *    driven by jobs.length, NOT hardcoded).
 *  - A "Fair & Transparent" trust panel that is a PRESENTATION of the existing fairness-queue
 *    concept — it renders no data and touches no algorithm.
 *  - Pill-style controls. Only the fairness-queue pill reflects real existing behaviour (the
 *    list is fairness-ordered). Distance / Earnings sorting DO NOT EXIST in the app, so those
 *    pills are rendered DISABLED / decorative and wire to nothing — no backend/sort was added.
 *  - Restyled job cards: service icon in a pastel squircle, compact priority badge, fairness
 *    badge, location, date/time, customer (+ rating only when present), and a tinted earnings
 *    footer with Decline (unchanged no-op, as before) + Accept (opens the same confirm modal).
 *
 * The `availableJobs` data, useState seeding, handleAccept (setAccepted → close modal →
 * setTimeout 1500ms filter-out), the Accept→modal→Confirm→handleAccept flow, and the Decline
 * button's existing behaviour are all preserved EXACTLY.
 */

// `serviceId` matches the ids in src/data/mockServices.js and is what the category filter keys
// off — the same field real bookings carry. These now span several categories so the filter is
// observably doing something: a plumber sees the two plumbing jobs, an electrician only the
// electrical one. 'Pipe Fitting' is a plumbing sub-skill, hence serviceId 'plumbing'.
const availableJobs = [
  { id: 'JOB001', serviceId: 'plumbing', serviceName: 'Plumbing', description: 'Bathroom pipe burst, urgent repair needed', address: 'Anandapur, Kolkata', date: '2026-09-01', time: '11:00 AM', estimatedPay: 450, customerName: 'Amit Singh', customerRating: 4.5, fairnessPosition: 1, urgency: 'high' },
  { id: 'JOB002', serviceId: 'electrical', serviceName: 'Electrical', description: 'Multiple switches not working in bedroom', address: 'Kasba Golpark, Kolkata', date: '2026-09-01', time: '2:00 PM', estimatedPay: 350, customerName: 'Neha Gupta', customerRating: 4.8, fairnessPosition: 2, urgency: 'medium' },
  { id: 'JOB003', serviceId: 'plumbing', serviceName: 'Pipe Fitting', description: 'New washing machine inlet pipe installation', address: 'Madurdaha, Kolkata', date: '2026-09-02', time: '10:00 AM', estimatedPay: 500, customerName: 'Raj Patel', customerRating: 4.2, fairnessPosition: 3, urgency: 'low' },
  { id: 'JOB004', serviceId: 'ac-repair', serviceName: 'AC Repair', description: 'AC not cooling properly, needs servicing', address: 'Chowbaga Road, Kolkata', date: '2026-09-02', time: '4:00 PM', estimatedPay: 400, customerName: 'Sita Devi', customerRating: 4.9, fairnessPosition: 4, urgency: 'medium' },
];

// LanguageContext stores a code ('en'|'hi'|'bn'); the AI service wants the English language NAME.
// Same mapping BookingScreen uses for getServiceDiagnosis.
const LANG_NAME = { en: 'English', hi: 'Hindi', bn: 'Bengali' };

// Priority presentation tokens (soft tinted pill + dot). Purely visual metadata, not buttons.
const PRIORITY = {
  high: { labelKey: 'high_priority', bg: colors.danger50, fg: colors.danger600, dot: colors.danger500 },
  medium: { labelKey: 'medium_priority', bg: colors.warning50, fg: colors.warning700, dot: colors.warning500 },
  low: { labelKey: 'low_priority', bg: colors.gray100, fg: colors.gray600, dot: colors.gray400 },
};

// Service → icon + pastel tint. Uses existing lucide-react-native icons only (no new deps).
// Falls back to a wrench + neutral tint for any unmapped service name.
const SERVICE_STYLE = {
  Plumbing: { Icon: Droplet, tint: '#eff6ff', fg: colors.info600 },
  'Pipe Fitting': { Icon: Wrench, tint: '#eef2ff', fg: colors.primary600 },
  Electrical: { Icon: Zap, tint: '#fffbeb', fg: colors.accent600 },
  Cleaning: { Icon: SprayCan, tint: '#ecfdf5', fg: colors.success600 },
  Carpentry: { Icon: Hammer, tint: '#fef2f2', fg: colors.danger600 },
  'AC Service': { Icon: Wind, tint: '#eff6ff', fg: colors.info600 },
  // Catalogue name in mockServices is "AC Repair"; without this it fell through to the generic
  // settings-cog fallback.
  'AC Repair': { Icon: Wind, tint: '#eff6ff', fg: colors.info600 },
};
function serviceStyle(name) {
  return SERVICE_STYLE[name] || { Icon: Settings, tint: colors.gray100, fg: colors.gray600 };
}

/**
 * Maps a REAL pending booking (from the customer portal) into the shape this feed renders.
 * Fields the booking record genuinely has are carried over; those it doesn't (customer rating,
 * an urgency grading) are left null so the UI omits them rather than inventing a value.
 */
const pendingToJob = (b) => ({
  id: b.id,
  // Carried through so the feed can filter by the worker's skill categories.
  serviceId: b.serviceId,
  serviceName: b.serviceName,
  description: b.description,
  address: b.address,
  date: b.date,
  time: b.time,
  estimatedPay: b.totalPrice,
  customerName: b.customerName,
  customerRating: null,
  fairnessPosition: b.fairnessPosition ?? 1,
  urgency: null,
  isRealBooking: true,
});

export default function JobFeedScreen() {
  const { t, resolvedLanguage } = useLanguage();
  // Groq wants the English language NAME, not the stored code — same mapping BookingScreen uses.
  const aiLanguageName = LANG_NAME[resolvedLanguage] || 'English';
  const { user, profile, workerProfile } = useAuth();
  // Identity of the worker who will be attached to a booking on accept.
  // Subscribes to the registration store so finishing training re-renders this screen (and
  // re-reads buildWorkerData) without needing a navigation bounce.
  useWorkerRegistration(user?.email);
  // Subscribes to booking mutations so this screen reflects departure/arrival/completion at once.
  useBookings();
  // Subscribes to stat changes so hitting the weekly hour cap locks this feed immediately.
  useWorkerStats();

  const worker = buildWorkerData(user, profile, workerProfile);
  const workerId = worker.mockWorkerId || user?.id;

  // Shared availability (toggled on the dashboard) + approved-leave state.
  const { onLeave, canAcceptJobs: statusAllows } = useWorkerStatus(workerId, {
    fallbackAvailable: worker.available,
    leaveRequests: worker.leaveRequests,
  });

  // Further gates on top of offline and on-leave:
  //  - training: a worker who took the free offline training instead of uploading an experience
  //    certificate cannot take work until the programme is finished and the certificate issued.
  //  - hour cap: at the weekly ceiling the worker is out of the pool until the week resets.
  const trainingBlocked = worker.trainingBlocked;
  const hourCapped = worker.hourCapped;
  const canAcceptJobs = statusAllows && !trainingBlocked && !hourCapped;

  // Real, customer-placed jobs awaiting acceptance + the seeded demo jobs.
  const [pendingJobs, setPendingJobs] = useState(() => (canAcceptJobs ? getPendingBookings().map(pendingToJob) : []));
  const [demoJobs, setDemoJobs] = useState(availableJobs);
  const [selectedJob, setSelectedJob] = useState(null);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [accepted, setAccepted] = useState(null);

  // The queue is only ever PULLED while the worker is online and off leave. Going offline freezes
  // it — whatever was listed stays on screen but every Accept is locked — and coming back online
  // refreshes it. Because `canAcceptJobs` is a dependency, this also re-runs the moment the
  // dashboard toggle flips while this tab is open, not just on focus.
  useFocusEffect(
    useCallback(() => {
      if (canAcceptJobs) setPendingJobs(getPendingBookings().map(pendingToJob));
    }, [canAcceptJobs]),
  );

  /**
   * CATEGORY GATE: a worker is only ever shown jobs in the skills they registered for. A job with
   * no serviceId at all is kept (it cannot be proven to be off-category), and a worker with no
   * recorded skills sees everything — so this can never silently empty the feed for accounts that
   * predate the skills dropdown.
   */
  const skillIds = worker.skillIds || [];
  const matchesSkills = (job) => skillIds.length === 0 || !job.serviceId || skillIds.includes(job.serviceId);

  const allJobs = [...pendingJobs, ...demoJobs];
  const jobs = allJobs.filter(matchesSkills);
  const hiddenByCategory = allJobs.length - jobs.length;

  // ---- Jobs this worker has already taken ----
  const activeJobs = getWorkerActiveJobs(workerId);
  // A worker may hold only one job at a time. Delegated to the store so the button state and
  // acceptBooking's enforcement share one definition — see hasActiveAcceptedJob for why it keys on
  // acceptedAt rather than just an active status (the seed ships the demo worker mid-job, which
  // previously locked Accept on a fresh install).
  const hasActiveJob = hasActiveAcceptedJob(workerId);

  // ---- Post-job feedback + complaints involving this worker ----
  useComplaints();
  // Finished, paid, and not yet reviewed by the worker — one submission per job.
  const jobsAwaitingFeedback = getWorkerPaidJobs(workerId).filter((j) => !hasWorkerFeedbackFor(j.id));
  const complaintsAgainstMe = getComplaintsAgainstWorker(workerId);

  /**
   * Kick the background Groq pass whenever this screen has a complaint with no suggestion yet.
   * Fire-and-forget by design — see src/services/complaintAdvisor.js. Keyed on the number of
   * queued items so it re-runs after a new complaint is filed, not on every render.
   */
  const awaitingAi = complaintsAgainstMe.filter((c) => c.aiStatus === 'idle').length;
  useEffect(() => {
    if (awaitingAi > 0) scheduleAdvisor(aiLanguageName);
  }, [awaitingAi, aiLanguageName]);

  /**
   * Records the worker's view of a finished job.
   *
   * A rating alone is stored as feedback with no complaint raised; adding a subject escalates it to
   * a complaint against the customer, which is what reaches the admin and the customer's portal.
   */
  const submitWorkerFeedback = (job, { rating, subject, description }) => {
    const hasIssue = subject.trim().length > 0;
    addWorkerComplaint({
      customerId: job.customerId,
      customerName: job.customerName,
      workerId: job.workerId,
      workerName: job.workerName || worker.name,
      bookingId: job.id,
      serviceName: job.serviceName,
      // With no issue reported this is a rating-only record, kept so the job drops off the to-review
      // list and the admin can still see the score.
      subject: hasIssue ? subject.trim() : t('feedback_no_issues'),
      description: description.trim(),
      rating: rating || null,
      priority: hasIssue ? 'medium' : 'low',
    });
    Alert.alert(
      hasIssue ? t('complaint_filed_title') : t('feedback_thanks_title'),
      hasIssue ? t('complaint_filed_msg') : t('worker_feedback_saved'),
    );
  };

  /**
   * While a job is en-route the "Job done" button must unlock on arrival, which is a time-based
   * condition — nothing mutates to trigger a re-render. This ticks once a second, but ONLY while
   * something is actually travelling, so an idle feed does no work. On the tick that arrival is
   * reached the booking is advanced to 'in-progress', which is what the customer's timeline shows.
   */
  const [, setTick] = useState(0);
  const travelling = activeJobs.some((j) => j.status === 'en-route');
  useEffect(() => {
    if (!travelling) return undefined;
    const id = setInterval(() => {
      activeJobs.forEach((j) => {
        if (j.status === 'en-route' && hasArrived(j)) markArrived(j.id);
      });
      setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [travelling, activeJobs]);

  const handleDepart = (job) => {
    Alert.alert(
      t('leave_for_job'),
      t('leave_for_job_warning'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('confirm_depart'), onPress: () => departForJob(job.id) },
      ],
    );
  };

  const handleJobDone = (job) => {
    if (!hasArrived(job)) {
      Alert.alert(t('job_done'), t('job_done_locked_msg'));
      return;
    }
    Alert.alert(
      t('job_done'),
      t('job_done_confirm_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('job_done'), onPress: () => completeJob(job.id) },
      ],
    );
  };

  // Tapping a locked Accept explains what to do instead of silently doing nothing.
  const explainLocked = () => {
    if (hourCapped) {
      Alert.alert(t('hours_capped_caps'), t('cannot_go_online_until_next_week', { cap: WEEKLY_HOUR_CAP }));
      return;
    }
    if (worker.certificatePending) {
      Alert.alert(t('cert_under_review_title'), t('cert_under_review_cannot_accept'));
      return;
    }
    if (trainingBlocked) {
      Alert.alert(t('training_in_progress_title'), t('training_cannot_accept'));
      return;
    }
    Alert.alert(
      onLeave ? t('on_leave_jobs_title') : t('offline_jobs_title'),
      onLeave ? t('on_leave_cannot_accept') : t('go_online_to_accept'),
    );
  };

  const handleAccept = (job) => {
    setShowAcceptModal(false);

    if (job.isRealBooking) {
      // Attach this worker to the customer's booking and advance it to 'assigned'. That is what
      // makes the professional appear — and live tracking become available — on the customer side.
      // acceptBooking returns null if the one-active-job rule blocks it (or someone else grabbed
      // the job first via sync). Only show the success overlay and remove the card when it actually
      // took — otherwise the worker gets a false "accepted" for a job they did not get.
      const result = acceptBooking(job.id, {
        workerId: worker.mockWorkerId || user?.id,
        workerName: worker.name,
        workerRating: worker.rating,
        workerPhone: worker.phone,
      });
      if (!result) {
        Alert.alert(t('finish_current_job_title'), t('finish_current_job_msg'));
        return;
      }
      setAccepted(job.id);
      setTimeout(() => setPendingJobs((p) => p.filter((x) => x.id !== job.id)), 1500);
    } else {
      // Demo jobs are not real bookings, so apply the same one-at-a-time rule here by hand.
      setAccepted(job.id);
      setTimeout(() => setDemoJobs((j) => j.filter((x) => x.id !== job.id)), 1500);
    }
  };

  const count = jobs.length;

  return (
    <ScreenContainer>
      {/* ---- Jobs already accepted by this worker: depart -> arrive -> done ---- */}
      {activeJobs.length > 0 && (
        <View style={styles.mineWrap}>
          <Text style={styles.mineHeading}>{t('my_jobs')}</Text>
          {activeJobs.map((job) => (
            <ActiveJobCard
              key={job.id}
              job={job}
              t={t}
              onDepart={() => handleDepart(job)}
              onDone={() => handleJobDone(job)}
            />
          ))}
        </View>
      )}

      {/* ---- Complaints filed AGAINST this worker, with the AI suggestion ---- */}
      {complaintsAgainstMe.map((c) => (
        <ComplaintAgainstYouCard key={c.id} complaint={c} filedByLabelKey="filed_by_customer" />
      ))}

      {/* ---- Feedback on finished, paid jobs: rate the customer, optionally report an issue ---- */}
      {jobsAwaitingFeedback.length > 0 && (
        <View style={styles.fbWrap}>
          <Text style={styles.mineHeading}>{t('rate_your_customers')}</Text>
          {jobsAwaitingFeedback.map((job) => (
            <WorkerFeedbackCard
              key={job.id}
              job={job}
              t={t}
              onSubmit={(payload) => submitWorkerFeedback(job, payload)}
            />
          ))}
        </View>
      )}

      {/* ---- Page header (dynamic count, not hardcoded) ---- */}
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>{t('available_jobs')}</Text>
          <Text style={styles.sub}>
            {t('jobs_near_you', { count, unit: count === 1 ? t('job') : t('jobs_lc') })}
          </Text>
        </View>
        {/* Fairness trust panel — presentation of the existing fairness-queue concept. */}
        <View style={styles.trustPanel}>
          <Scale size={16} color={colors.success700} strokeWidth={2.2} />
          <View style={styles.trustTextWrap}>
            <Text style={styles.trustTitle}>{t('fair_transparent')}</Text>
            <Text style={styles.trustSub}>{t('fairness_queue_sub')}</Text>
          </View>
        </View>
      </View>

      {/* ---- Lock banner: explains why accepting is unavailable. Training outranks offline /
              on-leave because it is the blocker the worker must clear first. ---- */}
      {!canAcceptJobs && (
        <View style={[styles.lockBanner, (onLeave || trainingBlocked || hourCapped || worker.certificatePending) && styles.lockBannerLeave]}>
          <View style={[styles.lockIcon, (onLeave || trainingBlocked || hourCapped || worker.certificatePending) && styles.lockIconLeave]}>
            {worker.certificatePending ? (
              <FileClock size={17} color={colors.warning700} strokeWidth={2.3} />
            ) : hourCapped ? (
              <Clock size={17} color={colors.warning700} strokeWidth={2.3} />
            ) : trainingBlocked ? (
              <GraduationCap size={17} color={colors.warning700} strokeWidth={2.3} />
            ) : onLeave ? (
              <CalendarOff size={17} color={colors.warning700} strokeWidth={2.3} />
            ) : (
              <PowerOff size={17} color={colors.gray600} strokeWidth={2.3} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.lockTitle, (onLeave || trainingBlocked || hourCapped || worker.certificatePending) && styles.lockTitleLeave]}>
              {worker.certificatePending
                ? t('cert_under_review_title')
                : hourCapped
                ? t('hours_capped_caps')
                : trainingBlocked ? t('training_in_progress_title') : onLeave ? t('on_leave_jobs_title') : t('offline_jobs_title')}
            </Text>
            <Text style={styles.lockDesc}>
              {worker.certificatePending
                ? t('cert_under_review_cannot_accept')
                : hourCapped
                ? t('cannot_go_online_until_next_week', { cap: WEEKLY_HOUR_CAP })
                : trainingBlocked ? t('training_jobs_desc') : onLeave ? t('on_leave_jobs_desc') : t('offline_jobs_desc')}
            </Text>
          </View>
        </View>
      )}

      {/* ---- Category note: makes the filter visible instead of jobs just silently missing ---- */}
      {skillIds.length > 0 && hiddenByCategory > 0 && (
        <View style={styles.skillNote}>
          <Filter size={13} color={colors.primary600} strokeWidth={2.3} />
          <Text style={styles.skillNoteText} numberOfLines={2}>
            {t('skill_filter_note', { skills: (worker.skills || []).join(', '), count: hiddenByCategory })}
          </Text>
        </View>
      )}

      {/* ---- Sort / filter pills ---- */}
      <View style={styles.pillRow}>
        {/* Reflects the real, existing behaviour: the list is fairness-ordered. */}
        <View style={[styles.pill, styles.pillActive]}>
          <Text style={[styles.pillText, styles.pillTextActive]}>{t('fairness_queue')}</Text>
          <ChevronDown size={14} color={colors.success700} strokeWidth={2.4} />
        </View>
        {/* Distance / Earnings sorting do NOT exist in the app — shown disabled, wire to nothing. */}
        <View style={[styles.pill, styles.pillDisabled]}>
          <Text style={styles.pillTextDisabled}>{t('distance')}</Text>
          <ChevronDown size={14} color={colors.gray300} strokeWidth={2.4} />
        </View>
        <View style={[styles.pill, styles.pillDisabled]}>
          <Text style={styles.pillTextDisabled}>{t('earnings')}</Text>
          <ChevronDown size={14} color={colors.gray300} strokeWidth={2.4} />
        </View>
      </View>

      {/* ---- Job list ---- */}
      <View style={styles.list}>
        {jobs.map((job) => {
          const pr = PRIORITY[job.urgency] || PRIORITY.low;
          const { Icon: SvcIcon, tint, fg } = serviceStyle(job.serviceName);
          const hasRating = job.customerRating != null && job.customerRating !== '';

          return (
            <View key={job.id} style={[styles.card, accepted === job.id && styles.cardAccepted]}>
              {/* Header: service icon + name, priority badge */}
              <View style={styles.cardHeader}>
                <View style={[styles.svcIcon, { backgroundColor: tint }]}>
                  <SvcIcon size={22} color={fg} strokeWidth={2.1} />
                </View>
                <View style={styles.titleWrap}>
                  <Text style={styles.serviceName} numberOfLines={1}>{job.serviceName}</Text>
                  {/* Fairness queue badge — existing position value, unchanged. */}
                  <View style={styles.fairnessBadge}>
                    <Scale size={12} color={colors.success700} strokeWidth={2.2} />
                    <Text style={styles.fairnessText}>{t('in_fair_queue', { pos: job.fairnessPosition })}</Text>
                  </View>
                </View>
                {/* Real bookings carry no urgency grading — omit the badge rather than invent one. */}
                {job.urgency ? (
                  <View style={[styles.priorityBadge, { backgroundColor: pr.bg }]}>
                    <View style={[styles.priorityDot, { backgroundColor: pr.dot }]} />
                    <Text style={[styles.priorityText, { color: pr.fg }]}>{t(pr.labelKey)}</Text>
                  </View>
                ) : null}
              </View>

              <Text style={styles.desc}>{job.description}</Text>

              {/* Meta grid */}
              <View style={styles.metaGrid}>
                <View style={styles.metaItem}>
                  <MapPin size={15} color={colors.gray400} strokeWidth={2} />
                  <Text style={styles.metaText} numberOfLines={2}>{job.address}</Text>
                </View>
                <View style={styles.metaSplit}>
                  <View style={styles.metaItemHalf}>
                    <Clock size={15} color={colors.gray400} strokeWidth={2} />
                    <Text style={styles.metaText}>{job.date} · {job.time}</Text>
                  </View>
                  <View style={styles.metaItemHalf}>
                    <User size={15} color={colors.gray400} strokeWidth={2} />
                    <Text style={styles.metaText} numberOfLines={1}>{job.customerName}</Text>
                    {hasRating && (
                      <View style={styles.ratingChip}>
                        <Star size={11} color={colors.accent500} fill={colors.accent500} strokeWidth={0} />
                        <Text style={styles.ratingText}>{job.customerRating}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* Earnings + actions footer (tinted) */}
              <View style={styles.footer}>
                <View style={styles.payWrap}>
                  <View style={styles.payAmount}>
                    <IndianRupee size={18} color={colors.success700} strokeWidth={2.4} />
                    <Text style={styles.pay}>{job.estimatedPay}</Text>
                  </View>
                  <Text style={styles.payLabel}>{t('estimated_earning')}</Text>
                </View>
                <View style={styles.actions}>
                  {/* Decline — preserved exactly as before (no onPress existed). */}
                  <Pressable style={styles.declineBtn}>
                    <XCircle size={16} color={colors.gray500} strokeWidth={2.2} />
                    <Text style={styles.declineText}>{t('decline')}</Text>
                  </Pressable>
                  {/* Accept — green and live when online; grey and locked when offline / on leave,
                      in which case tapping explains how to unlock it instead of doing nothing. */}
                  <Pressable
                    style={[styles.acceptBtn, (!canAcceptJobs || hasActiveJob) && styles.acceptBtnLocked]}
                    onPress={() => {
                      if (!canAcceptJobs) {
                        explainLocked();
                        return;
                      }
                      // One job at a time: don't even open the confirm sheet while a job is active.
                      if (hasActiveJob) {
                        Alert.alert(t('finish_current_job_title'), t('finish_current_job_msg'));
                        return;
                      }
                      setSelectedJob(job);
                      setShowAcceptModal(true);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canAcceptJobs || hasActiveJob }}
                    accessibilityLabel={t('accept_job')}
                  >
                    <CheckCircle size={16} color={canAcceptJobs ? colors.white : colors.gray500} strokeWidth={2.4} />
                    <Text style={[styles.acceptText, !canAcceptJobs && styles.acceptTextLocked]}>{t('accept_job')}</Text>
                  </Pressable>
                </View>
              </View>

              {accepted === job.id && (
                <View style={styles.acceptedOverlay}>
                  <CheckCircle size={34} color={colors.white} strokeWidth={2.2} />
                  <Text style={styles.acceptedText}>{t('job_accepted')}</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      <AcceptJobSheet
        job={selectedJob}
        isOpen={showAcceptModal}
        onClose={() => setShowAcceptModal(false)}
        onConfirm={handleAccept}
      />
    </ScreenContainer>
  );
}

/**
 * AcceptJobSheet — premium "Accept Job?" confirmation (frontend-only).
 *
 * Self-contained animated bottom sheet (RNModal + Animated slide-up) so the shared Modal
 * primitive used elsewhere is untouched. It renders ONLY existing job data and, on confirm,
 * plays a success animation (checkmark pop → confetti) and then calls the EXACT existing
 * onConfirm(job) handler (JobFeedScreen.handleAccept) — the acceptance flow is unchanged.
 *
 * OMITTED because the data doesn't exist (per "omit rather than invent"): distance, platform-fee
 * breakdown, relative countdown, estimated duration, service-area flag, and a live route/map
 * (there's no valid map route for an unaccepted job — a static preview stands in instead).
 */
function AcceptJobSheet({ job, isOpen, onClose, onConfirm }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { height } = useWindowDimensions();

  const translateY = useRef(new Animated.Value(height)).current;
  const scrimOpacity = useRef(new Animated.Value(0)).current;
  const checkScale = useRef(new Animated.Value(0)).current;

  const [success, setSuccess] = useState(false);
  const [confetti, setConfetti] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Reset transient success state each time the sheet opens for a (new) job.
      setSuccess(false);
      setConfetti(false);
      checkScale.setValue(0);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(scrimOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();
    } else {
      translateY.setValue(height);
      scrimOpacity.setValue(0);
    }
  }, [isOpen, height, translateY, scrimOpacity, checkScale]);

  if (!job) return null;

  const { Icon: SvcIcon, tint, fg } = serviceStyle(job.serviceName);
  const pr = PRIORITY[job.urgency] || PRIORITY.low;
  const isUrgent = job.urgency === 'high';

  const handleConfirm = () => {
    // 1) Success checkmark pops in. 2) Short delay → confetti. 3) Hand off to the EXISTING
    // acceptance flow (unchanged), which closes the sheet + removes the job after its 1.5s timer.
    setSuccess(true);
    Animated.spring(checkScale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start(() => {
      setTimeout(() => setConfetti(true), 200);
      setTimeout(() => onConfirm(job), 900);
    });
  };

  return (
    <RNSheet visible={isOpen} onRequestClose={onClose} scrimOpacity={scrimOpacity} onScrimPress={success ? undefined : onClose}>
      <Animated.View
        style={[styles.sheet, { maxHeight: height * 0.92, paddingBottom: insets.bottom + spacing.space4, transform: [{ translateY }] }]}
      >
        <View style={styles.handle} />

        {success ? (
          <View style={styles.successWrap}>
            <Confetti run={confetti} originY={30} />
            <Animated.View style={[styles.successIcon, { transform: [{ scale: checkScale }] }]}>
              <Check size={44} color={colors.white} strokeWidth={3.5} />
            </Animated.View>
            <Text style={styles.successTitle}>{t('job_accepted')}</Text>
            <Text style={styles.successSub}>{t('all_set')}</Text>
          </View>
        ) : (
          <>
            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>{t('accept_job_q')}</Text>
                <Text style={styles.sheetSub}>{t('accept_job_review')}</Text>
              </View>
              <Pressable style={styles.sheetClose} onPress={onClose} accessibilityLabel="Close" hitSlop={8}>
                <X size={20} color={colors.gray600} strokeWidth={2.2} />
              </Pressable>
            </View>

            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
              {/* Job header */}
              <View style={styles.jobHeader}>
                <View style={[styles.jobIcon, { backgroundColor: tint }]}>
                  <SvcIcon size={24} color={fg} strokeWidth={2.1} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.jobTitleRow}>
                    <Text style={styles.jobName} numberOfLines={1}>{job.serviceName}</Text>
                    {isUrgent && (
                      <View style={[styles.urgentBadge, { backgroundColor: pr.bg }]}>
                        <View style={[styles.urgentDot, { backgroundColor: pr.dot }]} />
                        <Text style={[styles.urgentText, { color: pr.fg }]}>{t('urgent')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.jobDesc}>{job.description}</Text>
                </View>
              </View>

              {/* Customer card */}
              <View style={styles.customerCard}>
                <View style={styles.custAvatar}>
                  <Text style={styles.custAvatarText}>{(job.customerName?.[0] || '?').toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.custName} numberOfLines={1}>{job.customerName}</Text>
                  <Text style={styles.custLabel}>{t('customer_label')}</Text>
                </View>
                {job.customerRating != null && (
                  <View style={styles.custRating}>
                    <Star size={12} color={colors.accent500} fill={colors.accent500} strokeWidth={0} />
                    <Text style={styles.custRatingText}>{job.customerRating}</Text>
                  </View>
                )}
              </View>

              {/* Earnings (prominent) */}
              <View style={styles.earnCard}>
                <View style={styles.earnIcon}>
                  <Wallet size={22} color={colors.success700} strokeWidth={2.1} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.earnAmountRow}>
                    <IndianRupee size={22} color={colors.success800} strokeWidth={2.6} />
                    <Text style={styles.earnAmount}>{job.estimatedPay}</Text>
                  </View>
                  <Text style={styles.earnLabel}>{t('estimated_earnings')}</Text>
                </View>
              </View>

              {/* Location + Time */}
              <View style={styles.infoRow}>
                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <MapPin size={15} color={colors.info600} strokeWidth={2.2} />
                    <Text style={styles.infoHeadText}>{t('location')}</Text>
                  </View>
                  <Text style={styles.infoValue} numberOfLines={3}>{job.address}</Text>
                </View>
                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <Clock size={15} color={colors.primary600} strokeWidth={2.2} />
                    <Text style={styles.infoHeadText}>{t('scheduled_time')}</Text>
                  </View>
                  <Text style={styles.infoValue}>{job.date}</Text>
                  <Text style={styles.infoValueSub}>{job.time}</Text>
                </View>
              </View>

              {/* Static map-style preview (frontend-only; no live route for an unaccepted job) */}
              <View style={styles.mapPreview}>
                <View style={styles.mapGridLine} />
                <View style={[styles.mapGridLine, styles.mapGridLine2]} />
                <View style={styles.mapPin}>
                  <MapPin size={20} color={colors.danger500} fill={colors.danger500} strokeWidth={0} />
                </View>
                <View style={styles.mapChip}>
                  <MapIcon size={13} color={colors.gray600} strokeWidth={2.2} />
                  <Text style={styles.mapChipText} numberOfLines={1}>{job.address}</Text>
                </View>
              </View>

              {/* Fairness Queue */}
              <View style={styles.fairnessCard}>
                <View style={styles.fairnessHead}>
                  <Scale size={17} color={colors.success700} strokeWidth={2.2} />
                  <Text style={styles.fairnessTitle}>{t('fairness_queue_title')}</Text>
                  <View style={styles.fairnessPos}>
                    <Text style={styles.fairnessPosText}>{t('in_queue', { pos: job.fairnessPosition })}</Text>
                  </View>
                </View>
                <Text style={styles.fairnessDesc}>{t('fairness_desc', { pos: job.fairnessPosition })}</Text>
              </View>

              {/* Why you received this job (only derivable reasons) */}
              <View style={styles.whyCard}>
                <View style={styles.whyHead}>
                  <Lightbulb size={16} color={colors.accent600} strokeWidth={2.2} />
                  <Text style={styles.whyTitle}>{t('why_received')}</Text>
                </View>
                <WhyItem text={t('why_fairness', { pos: job.fairnessPosition })} />
                <WhyItem text={t('why_skill', { service: job.serviceName })} last />
              </View>
            </ScrollView>

            {/* Actions */}
            <View style={styles.sheetActions}>
              <Pressable style={styles.notNowBtn} onPress={onClose} accessibilityLabel={t('not_now')}>
                <Text style={styles.notNowText}>{t('not_now')}</Text>
              </Pressable>
              <PressableScale style={styles.acceptForBtn} onPress={handleConfirm} accessibilityLabel={t('accept_for', { amount: job.estimatedPay })}>
                <Check size={18} color={colors.white} strokeWidth={2.6} />
                <Text style={styles.acceptForText}>{t('accept_for', { amount: job.estimatedPay })}</Text>
              </PressableScale>
            </View>
          </>
        )}
      </Animated.View>
    </RNSheet>
  );
}

/** Thin RN Modal wrapper providing the dark scrim + close-on-backdrop for the bottom sheet. */
function RNSheet({ visible, onRequestClose, children, scrimOpacity, onScrimPress }) {
  return (
    <RNModalNative visible={visible} transparent animationType="none" onRequestClose={onRequestClose} statusBarTranslucent>
      <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onScrimPress} accessibilityLabel="Dismiss" />
      </Animated.View>
      <View style={styles.sheetWrap} pointerEvents="box-none">
        {children}
      </View>
    </RNModalNative>
  );
}

function WhyItem({ text, last }) {
  return (
    <View style={[styles.whyItem, !last && styles.whyItemBorder]}>
      <View style={styles.whyCheck}>
        <Check size={12} color={colors.success700} strokeWidth={3} />
      </View>
      <Text style={styles.whyText}>{text}</Text>
    </View>
  );
}

/** PressableScale — small press-in scale for premium touch feedback (frontend-only). */
function PressableScale({ children, style, onPress, accessibilityLabel }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(scale, { toValue: v, friction: 6, tension: 180, useNativeDriver: true }).start();
  return (
    <Pressable onPress={onPress} onPressIn={() => to(0.97)} onPressOut={() => to(1)} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={styles.acceptForWrap}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * A job this worker has accepted, with the two lifecycle actions.
 *
 *  - "Leave for job" is offered only while the job is still 'assigned'; pressing it warns about
 *    late-departure penalty points first, and on confirmation unlocks the customer's live tracking.
 *  - "Job done" stays grey and inert until the worker has arrived at the address (per the demo
 *    tracker), then turns green. Tapping it while locked explains why rather than doing nothing.
 */
function ActiveJobCard({ job, t, onDepart, onDone }) {
  const { Icon, tint, fg } = serviceStyle(job.serviceName);
  const arrived = hasArrived(job);
  const departed = job.status !== 'assigned';

  const stageKey = job.status === 'assigned'
    ? 'stage_awaiting_departure'
    : arrived ? 'stage_at_location' : 'stage_on_the_way';

  return (
    <View style={styles.mineCard}>
      <View style={styles.mineTop}>
        <View style={[styles.mineIcon, { backgroundColor: tint }]}>
          <Icon size={18} color={fg} strokeWidth={2.3} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.mineService} numberOfLines={1}>{job.serviceName}</Text>
          <Text style={styles.mineAddr} numberOfLines={1}>{job.address}</Text>
        </View>
        <View style={[styles.mineStage, arrived && styles.mineStageArrived]}>
          <Text style={[styles.mineStageText, arrived && styles.mineStageTextArrived]}>{t(stageKey)}</Text>
        </View>
      </View>

      <View style={styles.mineMetaRow}>
        <Text style={styles.mineMeta}>#{job.id}</Text>
        <Text style={styles.mineMeta}>•</Text>
        <Text style={styles.mineMeta}>{job.customerName}</Text>
        <Text style={styles.mineMeta}>•</Text>
        <Text style={styles.mineMetaStrong}>₹{job.totalPrice}</Text>
      </View>

      <View style={styles.mineBtnRow}>
        {/* Once departed this button is spent — it is replaced by a static "on the way" state so
            the worker cannot re-trigger the journey. */}
        {departed ? (
          <View style={[styles.mineBtn, styles.mineBtnSpent]}>
            <Navigation2 size={15} color={colors.gray500} strokeWidth={2.3} />
            <Text style={styles.mineBtnSpentText}>{t('departed')}</Text>
          </View>
        ) : (
          <Pressable style={[styles.mineBtn, styles.mineBtnDepart]} onPress={onDepart}>
            <Navigation2 size={15} color={colors.white} strokeWidth={2.4} />
            <Text style={styles.mineBtnDepartText}>{t('leave_for_job')}</Text>
          </Pressable>
        )}

        <Pressable
          style={[styles.mineBtn, arrived ? styles.mineBtnDone : styles.mineBtnDoneLocked]}
          onPress={onDone}
          accessibilityRole="button"
          accessibilityState={{ disabled: !arrived }}
        >
          <CheckCircle size={15} color={arrived ? colors.white : colors.gray500} strokeWidth={2.4} />
          <Text style={arrived ? styles.mineBtnDoneText : styles.mineBtnDoneLockedText}>{t('job_done')}</Text>
        </Pressable>
      </View>

      {!arrived && departed && <Text style={styles.mineHint}>{t('job_done_unlocks_on_arrival')}</Text>}
    </View>
  );
}

/**
 * Worker's post-job feedback on a customer.
 *
 * Collapsed to a single row until tapped, because most finished jobs are unremarkable and a stack of
 * expanded forms would bury the actual job feed. The complaint fields are a second, deliberate step
 * inside that — rating a job should not feel like filing a grievance.
 */
function WorkerFeedbackCard({ job, t, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);

  if (!open) {
    return (
      <Pressable style={styles.fbCollapsed} onPress={() => setOpen(true)}>
        <View style={styles.fbIcon}>
          <MessageSquare size={15} color={colors.primary700} strokeWidth={2.3} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.fbCollapsedTitle} numberOfLines={1}>
            {t('review_job', { service: job.serviceName })}
          </Text>
          <Text style={styles.fbCollapsedSub} numberOfLines={1}>
            {job.customerName} · #{job.id}
          </Text>
        </View>
        <ChevronRight size={16} color={colors.gray400} />
      </Pressable>
    );
  }

  return (
    <View style={styles.fbCard}>
      <Text style={styles.fbTitle}>{t('review_job', { service: job.serviceName })}</Text>
      <Text style={styles.fbSub}>{job.customerName} · #{job.id}</Text>

      <Text style={styles.fbLabel}>{t('rate_the_customer')}</Text>
      <View style={styles.fbStarRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('rate_n_stars', { n })}>
            <Star
              size={28}
              color={n <= rating ? colors.accent500 : colors.gray300}
              fill={n <= rating ? colors.accent500 : 'transparent'}
              strokeWidth={2}
            />
          </Pressable>
        ))}
      </View>

      {!issueOpen ? (
        <Pressable style={styles.fbIssueToggle} onPress={() => setIssueOpen(true)}>
          <MessageSquareWarning size={15} color={colors.danger600} strokeWidth={2.3} />
          <Text style={styles.fbIssueToggleText}>{t('report_issue_with_customer')}</Text>
        </Pressable>
      ) : (
        <View style={styles.fbIssueBox}>
          <Text style={styles.fbIssueNote}>{t('worker_complaint_note')}</Text>
          <TextInput
            style={styles.fbInput}
            value={subject}
            onChangeText={setSubject}
            placeholder={t('complaint_subject_placeholder')}
            placeholderTextColor={colors.gray400}
          />
          <TextInput
            style={[styles.fbInput, styles.fbTextarea]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('complaint_body_placeholder')}
            placeholderTextColor={colors.gray400}
            multiline
            textAlignVertical="top"
          />
          <Pressable onPress={() => { setIssueOpen(false); setSubject(''); setDescription(''); }}>
            <Text style={styles.fbCancelIssue}>{t('remove_complaint')}</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.fbBtnRow}>
        <Pressable style={styles.fbCancelBtn} onPress={() => setOpen(false)}>
          <Text style={styles.fbCancelBtnText}>{t('cancel')}</Text>
        </Pressable>
        <Pressable
          style={[styles.fbSubmitBtn, rating === 0 && styles.fbSubmitBtnDisabled]}
          disabled={rating === 0}
          onPress={() => onSubmit({ rating, subject, description })}
        >
          <Text style={styles.fbSubmitBtnText}>{t('submit_feedback')}</Text>
        </Pressable>
      </View>
      {rating === 0 && <Text style={styles.fbHint}>{t('rating_required_hint')}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // ---- Worker feedback on a finished job ----
  fbWrap: { marginBottom: spacing.space5, gap: spacing.space2 },
  fbCollapsed: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space3,
    borderWidth: 1, borderColor: colors.gray200,
  },
  fbIcon: {
    width: 32, height: 32, borderRadius: radii.radiusFull, backgroundColor: colors.primary50,
    alignItems: 'center', justifyContent: 'center',
  },
  fbCollapsedTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.gray900 },
  fbCollapsedSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  fbCard: {
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, padding: spacing.space4,
    borderWidth: 1.5, borderColor: colors.primary100, gap: spacing.space2, ...shadows.shadowSm,
  },
  fbTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  fbSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },
  fbLabel: { fontSize: fontSizes.fsXs, color: colors.gray700, fontFamily: fontFamilies.interMedium, marginTop: spacing.space1 },
  fbStarRow: { flexDirection: 'row', gap: spacing.space2, justifyContent: 'center', paddingVertical: spacing.space1 },
  fbIssueToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.space2,
    paddingVertical: spacing.space2, borderRadius: radii.radiusMd,
    borderWidth: 1.5, borderColor: colors.danger200, backgroundColor: colors.danger50,
  },
  fbIssueToggleText: { fontSize: fontSizes.fsXs, color: colors.danger700, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  fbIssueBox: {
    gap: spacing.space2, padding: spacing.space3, borderRadius: radii.radiusMd,
    borderWidth: 1.5, borderColor: colors.danger200, backgroundColor: colors.danger50,
  },
  fbIssueNote: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, lineHeight: 16 },
  fbInput: {
    paddingVertical: spacing.space2, paddingHorizontal: spacing.space3,
    borderWidth: 1.5, borderColor: colors.gray200, borderRadius: radii.radiusMd,
    fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interRegular, color: colors.gray900,
    backgroundColor: colors.surfaceWhite,
  },
  fbTextarea: { minHeight: 76 },
  fbCancelIssue: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interMedium, textAlign: 'center' },
  fbBtnRow: { flexDirection: 'row', gap: spacing.space2, marginTop: spacing.space1 },
  fbCancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.space3,
    borderRadius: radii.radiusMd, backgroundColor: colors.gray100,
  },
  fbCancelBtnText: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  fbSubmitBtn: {
    flex: 2, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.space3,
    borderRadius: radii.radiusMd, backgroundColor: colors.primary700,
  },
  fbSubmitBtnDisabled: { opacity: 0.5 },
  fbSubmitBtnText: { fontSize: fontSizes.fsXs, color: colors.white, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  fbHint: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, textAlign: 'center' },

  // ---- My jobs (accepted) ----
  mineWrap: { marginBottom: spacing.space5, gap: spacing.space3 },
  mineHeading: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  mineCard: {
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, padding: spacing.space4,
    borderWidth: 1.5, borderColor: colors.primary100, gap: spacing.space3, ...shadows.shadowSm,
  },
  mineTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  mineIcon: { width: 38, height: 38, borderRadius: radii.radiusFull, alignItems: 'center', justifyContent: 'center' },
  mineService: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  mineAddr: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  mineStage: { paddingVertical: 3, paddingHorizontal: spacing.space2, borderRadius: radii.radiusFull, backgroundColor: colors.warning50, borderWidth: 1, borderColor: colors.warning200 },
  mineStageArrived: { backgroundColor: colors.success50, borderColor: colors.success100 },
  mineStageText: { fontSize: 10, color: colors.warning800, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  mineStageTextArrived: { color: colors.success700 },
  mineMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, flexWrap: 'wrap' },
  mineMeta: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },
  mineMetaStrong: { fontSize: fontSizes.fsXs, color: colors.gray900, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  mineBtnRow: { flexDirection: 'row', gap: spacing.space2 },
  mineBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.space2, paddingVertical: spacing.space3, borderRadius: radii.radiusMd,
  },
  mineBtnDepart: { backgroundColor: colors.primary600 },
  mineBtnDepartText: { color: colors.white, fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold },
  mineBtnSpent: { backgroundColor: colors.gray100 },
  mineBtnSpentText: { color: colors.gray500, fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold },
  mineBtnDone: { backgroundColor: colors.success600 },
  mineBtnDoneText: { color: colors.white, fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold },
  mineBtnDoneLocked: { backgroundColor: colors.gray200 },
  mineBtnDoneLockedText: { color: colors.gray500, fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold },
  mineHint: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, textAlign: 'center' },

  // ---- Header ----
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.space3, marginBottom: spacing.space4 },
  h1: { fontSize: fontSizes.fs3xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900, letterSpacing: -0.5 },
  sub: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.interMedium, marginTop: 3 },

  // ---- Fairness trust panel ----
  trustPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    maxWidth: 168,
    paddingVertical: spacing.space2,
    paddingHorizontal: spacing.space3,
    backgroundColor: colors.success50,
    borderRadius: radii.radiusLg,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  trustTextWrap: { flexShrink: 1 },
  trustTitle: { fontSize: 11.5, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold, color: colors.success800 },
  trustSub: { fontSize: 10, fontFamily: fontFamilies.interRegular, color: colors.success700, marginTop: 1 },

  // ---- Offline / on-leave lock banner ----
  lockBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    padding: spacing.space4, marginBottom: spacing.space4,
    backgroundColor: colors.gray50, borderWidth: 1, borderColor: colors.gray200,
    borderRadius: radii.radiusLg,
  },
  lockBannerLeave: { backgroundColor: colors.warning50, borderColor: colors.warning200 },
  lockIcon: {
    width: 34, height: 34, borderRadius: radii.radiusFull, backgroundColor: colors.gray200,
    alignItems: 'center', justifyContent: 'center',
  },
  lockIconLeave: { backgroundColor: colors.warning100 },
  lockTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  lockTitleLeave: { color: colors.warning800 },
  lockDesc: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, marginTop: 2, lineHeight: 16 },

  // ---- Skill-category filter note ----
  skillNote: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space2,
    paddingVertical: spacing.space2, paddingHorizontal: spacing.space3,
    marginBottom: spacing.space3,
    backgroundColor: colors.primary50, borderWidth: 1, borderColor: colors.primary100,
    borderRadius: radii.radiusMd,
  },
  skillNoteText: { flex: 1, fontSize: fontSizes.fsXs, color: colors.primary700, fontFamily: fontFamilies.interMedium, lineHeight: 15 },

  // ---- Sort / filter pills ----
  pillRow: { flexDirection: 'row', gap: spacing.space2, marginBottom: spacing.space4, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.space2,
    paddingHorizontal: spacing.space3,
    borderRadius: radii.radiusFull,
    borderWidth: 1,
    backgroundColor: colors.surfaceWhite,
    borderColor: colors.gray200,
  },
  pillActive: { backgroundColor: colors.success50, borderColor: '#6ee7b7' },
  pillDisabled: { backgroundColor: colors.gray50, borderColor: colors.gray100 },
  pillText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, color: colors.gray600 },
  pillTextActive: { color: colors.success700 },
  pillTextDisabled: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interMedium, color: colors.gray400 },

  // ---- List / card ----
  list: { gap: spacing.space4 },
  card: {
    backgroundColor: colors.surfaceWhite,
    borderRadius: radii.radiusXl,
    padding: spacing.space5,
    borderWidth: 1,
    borderColor: colors.gray100,
    ...shadows.shadowMd,
    overflow: 'hidden',
  },
  cardAccepted: { opacity: 0.6 },

  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.space3, marginBottom: spacing.space3 },
  svcIcon: { width: 46, height: 46, borderRadius: radii.radiusLg, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, gap: 6 },
  serviceName: { fontSize: fontSizes.fsLg, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },

  fairnessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 8,
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: radii.radiusFull,
  },
  fairnessText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, color: colors.success800 },

  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: radii.radiusFull,
  },
  priorityDot: { width: 6, height: 6, borderRadius: radii.radiusFull },
  priorityText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },

  desc: { fontSize: fontSizes.fsBase, color: colors.gray700, fontFamily: fontFamilies.interRegular, lineHeight: 21, marginBottom: spacing.space4 },

  // ---- Meta ----
  metaGrid: { gap: spacing.space3, marginBottom: spacing.space4 },
  metaItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  metaSplit: { flexDirection: 'row', gap: spacing.space3, flexWrap: 'wrap' },
  metaItemHalf: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: '45%' },
  metaText: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interMedium, flexShrink: 1 },
  ratingChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 6, backgroundColor: colors.accent50, borderRadius: radii.radiusFull },
  ratingText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold, color: colors.accent700 },

  // ---- Footer (earnings + actions) ----
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.space3,
    flexWrap: 'wrap',
    marginHorizontal: -spacing.space5,
    marginBottom: -spacing.space5,
    marginTop: spacing.space1,
    paddingHorizontal: spacing.space5,
    paddingVertical: spacing.space4,
    backgroundColor: colors.success50,
    borderTopWidth: 1,
    borderTopColor: '#d1fae5',
  },
  payWrap: { flexShrink: 0 },
  payAmount: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  pay: { fontSize: fontSizes.fs2xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.success800 },
  payLabel: { fontSize: fontSizes.fsXs, color: colors.success700, fontFamily: fontFamilies.interMedium, marginTop: 1 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  declineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: spacing.space3,
    borderRadius: radii.radiusMd,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.surfaceWhite,
  },
  declineText: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  acceptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: spacing.space4,
    borderRadius: radii.radiusMd,
    backgroundColor: colors.success600,
    ...shadows.shadowSm,
  },
  acceptText: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },
  // Locked (offline / on leave): grey instead of green, and visibly inert.
  acceptBtnLocked: { backgroundColor: colors.gray200, shadowOpacity: 0, elevation: 0 },
  acceptTextLocked: { color: colors.gray500 },

  acceptedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.success600, alignItems: 'center', justifyContent: 'center', gap: spacing.space2 },
  acceptedText: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },

  // ---- Accept Job bottom sheet ----
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17, 24, 39, 0.6)' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surfaceWhite,
    borderTopLeftRadius: radii.radius2xl,
    borderTopRightRadius: radii.radius2xl,
    paddingTop: spacing.space3,
    paddingHorizontal: spacing.space5,
    ...shadows.shadowXl,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radii.radiusFull, backgroundColor: colors.gray200, marginBottom: spacing.space3 },

  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.space3, marginBottom: spacing.space3 },
  sheetTitle: { fontSize: fontSizes.fs2xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900, letterSpacing: -0.5 },
  sheetSub: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2 },
  sheetClose: { width: 36, height: 36, borderRadius: radii.radiusFull, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' },

  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: { gap: spacing.space3, paddingBottom: spacing.space2 },

  // Job header
  jobHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.space3, paddingVertical: spacing.space2 },
  jobIcon: { width: 48, height: 48, borderRadius: radii.radiusLg, alignItems: 'center', justifyContent: 'center' },
  jobTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  jobName: { flexShrink: 1, fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  urgentBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: radii.radiusFull },
  urgentDot: { width: 6, height: 6, borderRadius: radii.radiusFull },
  urgentText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  jobDesc: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interRegular, lineHeight: 19, marginTop: 3 },

  // Customer card
  customerCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3, padding: spacing.space3,
    backgroundColor: colors.gray50, borderRadius: radii.radiusLg, borderWidth: 1, borderColor: colors.gray100,
  },
  custAvatar: { width: 44, height: 44, borderRadius: radii.radiusFull, backgroundColor: colors.primary600, alignItems: 'center', justifyContent: 'center' },
  custAvatarText: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },
  custName: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  custLabel: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interMedium, marginTop: 1 },
  custRating: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 3, paddingHorizontal: 8, backgroundColor: colors.accent50, borderRadius: radii.radiusFull },
  custRatingText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold, color: colors.accent700 },

  // Earnings card
  earnCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3, padding: spacing.space4,
    backgroundColor: colors.success50, borderRadius: radii.radiusXl, borderWidth: 1, borderColor: '#a7f3d0',
  },
  earnIcon: { width: 44, height: 44, borderRadius: radii.radiusLg, backgroundColor: colors.success100, alignItems: 'center', justifyContent: 'center' },
  earnAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  earnAmount: { fontSize: fontSizes.fs3xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.success800 },
  earnLabel: { fontSize: fontSizes.fsSm, color: colors.success700, fontFamily: fontFamilies.interMedium, marginTop: 1 },

  // Location + time
  infoRow: { flexDirection: 'row', gap: spacing.space3 },
  infoCard: { flex: 1, padding: spacing.space3, backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, borderWidth: 1, borderColor: colors.gray100 },
  infoHead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  infoHeadText: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  infoValue: { fontSize: fontSizes.fsSm, color: colors.gray900, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  infoValueSub: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interMedium, marginTop: 1 },

  // Map preview (static, frontend-only)
  mapPreview: {
    height: 96, borderRadius: radii.radiusLg, backgroundColor: colors.info50, borderWidth: 1, borderColor: '#dbeafe',
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  mapGridLine: { position: 'absolute', width: '140%', height: 1, backgroundColor: '#bfdbfe', transform: [{ rotate: '-18deg' }], top: '38%' },
  mapGridLine2: { top: '66%', transform: [{ rotate: '-18deg' }] },
  mapPin: { marginBottom: 6 },
  mapChip: {
    position: 'absolute', bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '86%',
    paddingVertical: 5, paddingHorizontal: spacing.space3, backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusFull, ...shadows.shadowSm,
  },
  mapChipText: { fontSize: fontSizes.fsXs, color: colors.gray700, fontFamily: fontFamilies.interMedium, flexShrink: 1 },

  // Fairness card
  fairnessCard: { padding: spacing.space4, backgroundColor: colors.success50, borderRadius: radii.radiusXl, borderWidth: 1, borderColor: '#a7f3d0' },
  fairnessHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  fairnessTitle: { flex: 1, fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.success800 },
  fairnessPos: { paddingVertical: 3, paddingHorizontal: 10, backgroundColor: colors.success600, borderRadius: radii.radiusFull },
  fairnessPosText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold, color: colors.white },
  fairnessDesc: { fontSize: fontSizes.fsXs, color: colors.success700, fontFamily: fontFamilies.interRegular, lineHeight: 17, marginTop: spacing.space2 },

  // Why card
  whyCard: { padding: spacing.space4, backgroundColor: colors.accent50, borderRadius: radii.radiusXl, borderWidth: 1, borderColor: colors.accent100 },
  whyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, marginBottom: spacing.space1 },
  whyTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  whyItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, paddingVertical: 9 },
  whyItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.accent100 },
  whyCheck: { width: 20, height: 20, borderRadius: radii.radiusFull, backgroundColor: colors.success100, alignItems: 'center', justifyContent: 'center' },
  whyText: { flex: 1, fontSize: fontSizes.fsSm, color: colors.gray700, fontFamily: fontFamilies.interMedium },

  // Actions
  sheetActions: { flexDirection: 'row', gap: spacing.space3, marginTop: spacing.space4 },
  notNowBtn: { flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radii.radiusLg, borderWidth: 1.5, borderColor: colors.gray200, backgroundColor: colors.surfaceWhite },
  notNowText: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.gray700 },
  acceptForWrap: { flex: 2 },
  acceptForBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 52,
    borderRadius: radii.radiusLg, backgroundColor: colors.success600, ...shadows.shadowMd, shadowColor: colors.success600,
  },
  acceptForText: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },

  // Success state
  successWrap: { alignItems: 'center', paddingVertical: spacing.space10, paddingHorizontal: spacing.space4 },
  successIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.success500, alignItems: 'center', justifyContent: 'center', ...shadows.shadowGlow, shadowColor: colors.success500 },
  successTitle: { fontSize: fontSizes.fs2xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900, marginTop: spacing.space4 },
  successSub: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.interRegular, textAlign: 'center', marginTop: spacing.space2 },
});
