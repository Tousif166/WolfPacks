import { useState } from 'react';
import { View, Text, Pressable, Image, Alert, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Power, Star, Briefcase, IndianRupee, Clock, BookOpen,
  AlertTriangle, Award, Umbrella, MapPin, UserRound, CalendarClock, Bell, LogOut, Bike, Check,
  GraduationCap, FileText, CheckCircle2, FileClock, UserCheck, BadgeCheck,
} from 'lucide-react-native';
import { useAuth } from '@context/AuthContext';
import { useLanguage } from '@context/LanguageContext';
import { getBookingsByWorker } from '@data/mockBookings';
import { useWorkerStatus, setWorkerAvailability } from '@data/workerStatus';
import { useWorkerRegistration, trainingModules, TRAINING_TOTAL_MODULES } from '@data/workerRegistration';
import { useWorkerStats, acknowledgePayment, WEEKLY_HOUR_CAP } from '@data/workerStats';
import { useBookings } from '@data/mockBookings';
import { ScreenContainer, SectionHeader, GradientBand } from '@components/app';
import Badge from '@components/ui/Badge';
import ProgressRing from '@components/ui/ProgressRing';
import HelplineModal from '@components/HelplineModal';
import { buildWorkerData } from './workerData';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

const BRAND_LOGO = require('@assets/logo.png');

/**
 * WorkerDashboardScreen — worker home.
 *
 * ALL business logic preserved unchanged (buildWorkerData resolution, getBookingsByWorker, the
 * overtime thresholds, CIBIL/insurance/leave/loyalty rules, availability toggle, navigation).
 *
 * UI REDESIGN (frontend-only): gradient header (react-native-svg via GradientBand) showing the
 * EXISTING brand logo asset (@assets/logo.png — same as the app icon) + greeting + bell + logout;
 * premium ONLINE card; earnings-forward Performance panel; Civic Quality Score and Weekly Hours
 * rendered as real svg progress RINGS derived from the existing value/max; refined Insurance and
 * Leave surfaces; a compact zone/mobility status bar; recent jobs list.
 *
 * NOTE (no invented data): the app's worker data has NO earnings-trend or monthly-history field,
 * so NO "↑x% from last month" indicator or bar chart is shown — that would fabricate data the
 * backend doesn't provide. Every value here is read from `worker`/`bookings` exactly as before.
 */
export default function WorkerDashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, profile, workerProfile, logout } = useAuth();
  const { t } = useLanguage();
  // Subscribes to the registration store so completing training updates this screen immediately.
  useWorkerRegistration(user?.email);
  // Subscribes to earnings/hours/rating/score changes and to booking mutations, so a customer's
  // payment reflects here without the worker having to navigate away and back.
  useWorkerStats();
  useBookings();

  const worker = buildWorkerData(user, profile, workerProfile);

  // Free-offline-training programme (only present when the worker enrolled instead of uploading
  // an experience certificate). `trainingBlocked` is what keeps job accepting locked until done.
  const training = worker.training;
  // The named curriculum with per-module sign-off, read-only for the trainee.
  const modules = trainingModules({ training });
  const trainingDone = training?.status === 'completed';

  // While an uploaded certificate awaits admin review the dashboard collapses to a single notice —
  // no availability toggle, no performance, benefits, active job or history.
  const certificatePending = worker.certificatePending;

  const bookings = worker.mockWorkerId ? getBookingsByWorker(worker.mockWorkerId) : [];
  const activeBooking = bookings.find((b) => ['en-route', 'in-progress', 'assigned'].includes(b.status));

  // Availability now lives in the shared worker-status store (persisted), not local state, so the
  // Jobs tab and the admin portal both see it. Leave is derived from approved leave requests.
  const workerId = worker.mockWorkerId || user?.id;
  const { available, onLeave } = useWorkerStatus(workerId, {
    fallbackAvailable: worker.available,
    leaveRequests: worker.leaveRequests,
  });
  // Reaching the weekly hour ceiling takes the worker out of the pool for the rest of the week —
  // the toggle locks, same as approved leave does.
  const hourCapped = worker.hourCapped;
  // On approved leave (or at the hour cap) the worker is out of the pool regardless of the toggle.
  const isAvailable = available && !onLeave && !hourCapped;
  const [showHelpline, setShowHelpline] = useState(false);

  const isNearOvertime = (worker.weekly_hours_worked || 0) >= 36;
  const isAtOvertime = (worker.weekly_hours_worked || 0) >= 40;
  const ratingDisplay = worker.rating != null ? worker.rating.toFixed(1) : '—';

  const hoursColor = isAtOvertime ? colors.danger500 : isNearOvertime ? colors.warning500 : colors.success500;
  const cibilColor = (worker.cibil_score ?? 0) > 750 ? colors.success500 : colors.warning500;

  const formatValue = (val) => {
    if (typeof val === 'string') return val;
    if (typeof val !== 'number') return '—';
    if (val >= 10000) return `${(val / 1000).toFixed(1)}k`;
    return val.toLocaleString();
  };
  const queueDisplay = worker.fairnessPosition != null ? `#${worker.fairnessPosition}` : '—';
  const firstName = worker.name.split(' ')[0];

  // Visual job-lifecycle stepper — maps the EXISTING booking status onto the standard worker
  // path (invents no state). Statuses off this linear path (e.g. cancelled) return -1 and the
  // stepper is simply not shown for that job.
  const JOB_LIFECYCLE = [t('step_accepted'), t('step_en_route'), t('step_at_location'), t('step_completed')];
  const JOB_STATUS_STEP = { assigned: 0, booked: 0, 'en-route': 1, 'in-progress': 2, completed: 3 };
  const activeStep = activeBooking ? (JOB_STATUS_STEP[activeBooking.status] ?? -1) : -1;

  return (
    <ScreenContainer scroll style={styles.canvas} contentStyle={styles.content} edges={false}>
      {/* Gradient header with EXISTING brand logo */}
      <GradientBand
        colors={['#b45309', '#d97706', '#f59e0b']}
        angle="diagonal"
        decor
        style={[styles.headerBand, { paddingTop: insets.top + spacing.space4 }]}
      >
        <View style={styles.headerTopRow}>
          <View style={styles.brandRow}>
            <View style={styles.logoWrap}>
              <Image source={BRAND_LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="Sahakar Seva logo" />
            </View>
            <View style={styles.brandText}>
              <Text style={styles.brandName}>{t('brand_name')}</Text>
              <Text style={styles.brandRole}>{t('worker_role')}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <Pressable style={styles.headerIconBtn} onPress={() => setShowHelpline(true)} accessibilityLabel="Notifications" hitSlop={6}>
              <Bell size={19} color={colors.white} />
              <View style={styles.bellDot} />
            </Pressable>
            <Pressable style={styles.headerIconBtn} onPress={logout} accessibilityLabel="Log out" hitSlop={6}>
              <LogOut size={19} color={colors.white} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.greetName} numberOfLines={1}>{t('greet_namaste', { name: firstName })}</Text>
        <Text style={styles.greetSub}>{t('greet_ready')}</Text>

        {/* STATUS PILL — same two mutually-exclusive states as the profile screen, from the same
            derived values, so the worker cannot see "Verified" here and "Training in progress"
            there. Rendered on the gradient, hence the translucent treatment. */}
        {worker.verified ? (
          <View style={styles.statusPill}>
            <BadgeCheck size={13} color={colors.white} strokeWidth={2.5} />
            <Text style={styles.statusPillText}>{t('verified_workers')}</Text>
          </View>
        ) : worker.inTraining ? (
          <View style={styles.statusPill}>
            <GraduationCap size={13} color={colors.white} strokeWidth={2.5} />
            <Text style={styles.statusPillText}>{t('training_in_progress_title')}</Text>
          </View>
        ) : null}
      </GradientBand>

      <View style={styles.body}>
        {/* Setup prompt for real workers w/ incomplete profile */}
        {!worker.isDemo && !workerProfile && (
          <View style={styles.setupCard}>
            <AlertTriangle size={20} color={colors.warning500} />
            <View style={{ flex: 1 }}>
              <Text style={styles.setupTitle}>{t('complete_profile')}</Text>
              <Text style={styles.setupText}>{t('complete_profile_desc')}</Text>
            </View>
          </View>
        )}

        {/* Certificate under review — while this is showing, WorkerTabs has withheld every other
            tab, so this card IS the worker's portal until an admin decides. */}
        {certificatePending && (
          <View style={styles.reviewCard}>
            <View style={styles.reviewIcon}>
              <FileClock size={22} color={colors.primary700} strokeWidth={2.2} />
            </View>
            <Text style={styles.reviewTitle}>{t('cert_under_review_title')}</Text>
            <Text style={styles.reviewBody}>{t('cert_under_review_body')}</Text>
            <View style={styles.reviewMetaBox}>
              <Text style={styles.reviewMetaLabel}>{t('submitted_certificate')}</Text>
              <Text style={styles.reviewMetaValue} numberOfLines={1}>{worker.certificate?.name || '—'}</Text>
              <Text style={styles.reviewMetaLabel}>{t('claimed_skills_label')}</Text>
              <Text style={styles.reviewMetaValue} numberOfLines={2}>{(worker.skills || []).join(', ') || '—'}</Text>
            </View>
            <Text style={styles.reviewLocked}>{t('features_locked_during_review')}</Text>
          </View>
        )}

        {/* VERIFICATION UNDER PROCESS — shown while the worker is in the training programme.
            
            This is the state a worker lands in after an admin declines their certificate as
            "Doesn't meet requirements": the certificate is rejected (so the review card above no
            longer applies) and a training programme is attached instead. Previously that left the
            dashboard with no notice at all explaining why jobs were unavailable — the only hint was
            the progress card further down. This states it plainly, and states the exit condition. */}
        {!certificatePending && worker.inTraining && (
          <View style={styles.verifyingCard}>
            <View style={styles.verifyingIcon}>
              <GraduationCap size={20} color={colors.warning700} strokeWidth={2.3} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.verifyingTitle}>{t('verification_under_process')}</Text>
              <Text style={styles.verifyingBody}>{t('verification_under_process_desc')}</Text>
              <View style={styles.verifyingLockRow}>
                <AlertTriangle size={12} color={colors.warning700} strokeWidth={2.4} />
                <Text style={styles.verifyingLockText}>{t('cannot_accept_while_training')}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Payment received — parked by the customer's payment and dismissed once acknowledged, so
            it is a one-time notice rather than a permanent banner. */}
        {!certificatePending && worker.pendingPayment && (
          <View style={styles.paidCard}>
            <View style={styles.paidIcon}>
              <IndianRupee size={18} color={colors.success700} strokeWidth={2.5} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.paidTitle}>{t('you_have_been_paid')}</Text>
              <Text style={styles.paidSub}>
                {t('you_have_been_paid_sub', {
                  amount: worker.pendingPayment.amount,
                  id: worker.pendingPayment.bookingId || '—',
                })}
              </Text>
            </View>
            <Pressable
              style={styles.paidDismiss}
              onPress={() => acknowledgePayment(workerId)}
              accessibilityLabel={t('dismiss')}
            >
              <Check size={16} color={colors.success700} strokeWidth={2.6} />
            </Pressable>
          </View>
        )}

        {/* Training programme — shown above availability because while it is unfinished it is the
            blocker the worker has to clear before any job can be accepted. */}
        {training && (
          <View style={[styles.trainCard, trainingDone ? styles.trainCardDone : styles.trainCardActive]}>
            <View style={styles.trainHeadRow}>
              <View style={[styles.trainIcon, trainingDone && styles.trainIconDone]}>
                {trainingDone ? (
                  <Award size={18} color={colors.success700} strokeWidth={2.3} />
                ) : (
                  <GraduationCap size={18} color={colors.warning700} strokeWidth={2.3} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.trainTitle, trainingDone && styles.trainTitleDone]}>
                  {trainingDone ? t('training_completed_title') : t('training_enrolled_title')}
                </Text>
                <Text style={styles.trainSub}>
                  {trainingDone
                    ? t('training_completed_sub')
                    : t('training_enrolled_sub', { skills: (worker.skills || []).join(', ') })}
                </Text>
              </View>
            </View>

            {trainingDone ? (
              <View style={styles.trainCertRow}>
                <FileText size={13} color={colors.success700} strokeWidth={2.2} />
                <Text style={styles.trainCertText} numberOfLines={2}>
                  {t('training_cert_issued')}
                </Text>
              </View>
            ) : (
              <>
                {/* Progress over the programme's modules. */}
                <View style={styles.trainBarTrack}>
                  <View
                    style={[
                      styles.trainBarFill,
                      {
                        width: `${Math.round(
                          ((training.modulesDone || 0) / (training.modulesTotal || TRAINING_TOTAL_MODULES)) * 100,
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.trainProgressText}>
                  {t('training_modules_progress', {
                    done: training.modulesDone || 0,
                    total: training.modulesTotal || TRAINING_TOTAL_MODULES,
                  })}
                </Text>

                {/* The named curriculum, read-only. A trainee can see exactly what they have been
                    signed off on and by whom, but cannot tick anything themselves. */}
                <View style={styles.modList}>
                  {modules.map((m) => (
                    <View key={m.index} style={styles.modRow}>
                      {m.done ? (
                        <CheckCircle2 size={14} color={colors.success700} strokeWidth={2.4} />
                      ) : (
                        <View style={styles.modDot} />
                      )}
                      <Text style={[styles.modName, m.done && styles.modNameDone]} numberOfLines={1}>
                        {t(m.key)}
                      </Text>
                      {m.done && m.byName ? (
                        <Text style={styles.modBy} numberOfLines={1}>
                          {m.byName}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>

                <View style={styles.trainNote}>
                  <Text style={styles.trainNoteText}>{t('training_can_accept_after')}</Text>
                </View>

                {/* WHO SIGNS THIS OFF. Previously the trainee had a "mark complete" button here,
                    which made the programme meaningless — anyone could certify themselves into
                    being employable. Progress is now marked by an assigned trainer (a verified
                    worker) or the cooperative admin, so the trainee sees status only. */}
                {/* A FINISHED programme is not "awaiting" anything, so it reports who signed it off
                    instead. This line previously keyed only on trainerName, so a programme completed
                    by an admin with no trainer ever assigned displayed "Awaiting trainer assignment"
                    beside a Verified badge — two statements that flatly contradicted each other. */}
                <View style={styles.trainerRow}>
                  <UserCheck size={13} color={colors.primary700} strokeWidth={2.2} />
                  <Text style={styles.trainerText} numberOfLines={2}>
                    {training.trainerName
                      ? t('training_your_trainer', { name: training.trainerName })
                      : trainingDone && training.completedByName
                        ? t('training_completed_by', { name: training.completedByName })
                        : t('training_awaiting_trainer')}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* Everything below is withheld while a certificate is under review, AND while the worker is
            still in training.

            THE AVAILABILITY TOGGLE IS PART OF "BELOW". It used to render for a trainee, showing
            "ONLINE — You're accepting new jobs", which directly contradicted the training lock: the
            worker was told they were accepting jobs by one card and refused by another. Going online
            is meaningless until they are actually eligible for work, so the whole block (toggle,
            performance, benefits, active job, history) is withheld until the programme is finished
            and the certificate issued — exactly as it already was for a pending certificate. */}
        {!certificatePending && !worker.trainingBlocked && (
        <>
        {/* Availability */}
        <View style={[styles.availCard, (onLeave || hourCapped) ? styles.availLeave : isAvailable ? styles.availOn : styles.availOff]}>
          <View style={[styles.availIcon, (onLeave || hourCapped) ? styles.availIconLeave : isAvailable ? styles.availIconOn : styles.availIconOff]}>
            <Power
              size={20}
              color={(onLeave || hourCapped) ? colors.warning600 : isAvailable ? colors.success600 : colors.gray400}
              strokeWidth={2.2}
            />
          </View>
          <View style={styles.availInfo}>
            <View style={styles.availTitleRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: (onLeave || hourCapped) ? colors.warning500 : isAvailable ? colors.success500 : colors.gray400 },
                ]}
              />
              <Text style={styles.availTitle}>
                {hourCapped ? t('hours_capped_caps') : onLeave ? t('on_leave_caps') : isAvailable ? t('online') : t('offline')}
              </Text>
            </View>
            <Text style={styles.availSub}>
              {hourCapped
                ? t('hours_capped_sub', { cap: WEEKLY_HOUR_CAP })
                : onLeave ? t('on_leave_sub') : isAvailable ? t('accepting_jobs') : t('not_accepting_jobs')}
            </Text>
          </View>
          {/* Locked while on approved leave OR at the weekly hour ceiling — going "online" must not
              put a worker who is out of the pool back into it. */}
          <Pressable
            style={[styles.toggle, isAvailable ? styles.toggleOn : styles.toggleOff, (onLeave || hourCapped) && styles.toggleLocked]}
            onPress={() => {
              if (hourCapped) {
                Alert.alert(t('hours_capped_caps'), t('cannot_go_online_until_next_week', { cap: WEEKLY_HOUR_CAP }));
                return;
              }
              setWorkerAvailability(workerId, !available);
            }}
            disabled={onLeave}
            accessibilityRole="switch"
            accessibilityState={{ checked: isAvailable, disabled: onLeave || hourCapped }}
            accessibilityLabel="Toggle availability"
          >
            <View style={[styles.knob, isAvailable ? styles.knobOn : styles.knobOff]} />
          </Pressable>
        </View>

        {/* Your Performance — earnings forward */}
        <View style={styles.section}>
          <SectionHeader title={t('your_performance')} />
          <View style={styles.perfCard}>
            <View style={styles.earnRow}>
              <View style={styles.earnIcon}>
                <IndianRupee size={20} color={colors.success700} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.earnLabel}>{t('total_earnings')}</Text>
                <Text style={styles.earnValue} numberOfLines={1} adjustsFontSizeToFit>₹{formatValue(worker.earnings)}</Text>
              </View>
            </View>

            <View style={styles.perfDivider} />

            <View style={styles.perfMetrics}>
              <View style={styles.perfMetric}>
                <View style={styles.perfMetricHead}>
                  <Briefcase size={14} color={colors.primary600} strokeWidth={2.2} />
                  <Text style={styles.perfMetricLabel}>{t('jobs')}</Text>
                </View>
                <Text style={styles.perfMetricValue} numberOfLines={1} adjustsFontSizeToFit>{formatValue(worker.totalJobs)}</Text>
              </View>
              <View style={styles.perfMetricDivider} />
              <View style={styles.perfMetric}>
                <View style={styles.perfMetricHead}>
                  <Star size={14} color={colors.warning600} strokeWidth={2.2} />
                  <Text style={styles.perfMetricLabel}>{t('rating')}</Text>
                </View>
                <View style={styles.perfMetricValueRow}>
                  <Text style={styles.perfMetricValue} numberOfLines={1}>{ratingDisplay}</Text>
                  {worker.rating != null ? <Star size={14} color={colors.accent400} fill={colors.accent400} /> : null}
                </View>
              </View>
              <View style={styles.perfMetricDivider} />
              <View style={styles.perfMetric}>
                <View style={styles.perfMetricHead}>
                  <Clock size={14} color={colors.info600} strokeWidth={2.2} />
                  <Text style={styles.perfMetricLabel}>{t('queue')}</Text>
                </View>
                <Text style={styles.perfMetricValue} numberOfLines={1} adjustsFontSizeToFit>{queueDisplay}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Worker Benefits */}
        <View style={styles.section}>
          <SectionHeader title={t('worker_benefits')} />

          {/* Two ring cards side by side */}
          <View style={styles.ringRow}>
            {/* Civic Quality Score */}
            <View style={styles.ringCard}>
              <Text style={styles.ringTitle}>{t('civic_quality_score')}</Text>
              {worker.cibil_score != null ? (
                <>
                  <ProgressRing value={worker.cibil_score} max={900} size={110} stroke={11} color={cibilColor} trackColor={colors.gray200}>
                    <Text style={styles.ringValue}>{worker.cibil_score}</Text>
                    <Text style={styles.ringMax}>/ 900</Text>
                  </ProgressRing>
                  <Text style={[styles.ringCaption, { color: worker.cibil_score > 750 ? colors.success700 : colors.warning700 }]}>
                    {worker.cibil_score > 750 ? t('excellent') : t('improving')}
                  </Text>
                  <Text style={styles.ringSub}>
                    {worker.cibil_score > 750 ? t('priority_jobs_eligible') : t('keep_improving')}
                  </Text>
                </>
              ) : (
                <View style={styles.ringEmpty}><Text style={styles.ringSub}>{t('not_assessed')}</Text></View>
              )}
            </View>

            {/* Weekly Hours */}
            <View style={styles.ringCard}>
              <Text style={styles.ringTitle}>{t('weekly_hours')}</Text>
              <ProgressRing value={worker.weekly_hours_worked || 0} max={40} size={110} stroke={11} color={hoursColor} trackColor={colors.gray200}>
                <Text style={styles.ringValue}>{worker.weekly_hours_worked}h</Text>
                <Text style={styles.ringMax}>/ 40h</Text>
              </ProgressRing>
              <Text
                style={[
                  styles.ringCaption,
                  { color: isAtOvertime ? colors.danger600 : isNearOvertime ? colors.warning700 : colors.success700 },
                ]}
                numberOfLines={2}
              >
                {isAtOvertime ? t('cap_reached') : isNearOvertime ? t('approaching_limit') : t('healthy_week')}
              </Text>
              <Text style={styles.ringSub} numberOfLines={2}>
                {isAtOvertime ? t('ot_note') : isNearOvertime ? t('ot_soon') : t('great_balance')}
              </Text>
            </View>
          </View>

          {/* Insurance */}
          <View style={[styles.benefitCard, worker.insurance_eligible && styles.benefitCardActive]}>
            <View style={[styles.benefitIcon, { backgroundColor: (worker.insurance_eligible ? colors.success500 : colors.warning500) + '1A' }]}>
              <Umbrella size={20} color={worker.insurance_eligible ? colors.success600 : colors.warning600} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.benefitLabel}>{t('worker_insurance')}</Text>
              <Text style={[styles.benefitValue, { color: worker.insurance_eligible ? colors.success700 : colors.warning700 }]}>
                {worker.insurance_eligible ? t('insurance_active') : t('insurance_not_eligible')}
              </Text>
              <Text style={styles.benefitSub}>
                {worker.insurance_eligible ? t('insurance_active_desc') : t('insurance_eligible_desc')}
              </Text>
            </View>
          </View>

          {/* Leave */}
          <View style={styles.benefitCard}>
            <View style={[styles.benefitIcon, { backgroundColor: colors.primary50 }]}>
              <Award size={20} color={colors.primary600} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.leaveHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.benefitLabel}>{t('leave_balance')}</Text>
                  <Text style={styles.benefitValue}>
                    {worker.leave_balance} <Text style={styles.benefitValueSmall}>{t('days_left')}</Text>
                  </Text>
                </View>
                <Pressable onPress={() => navigation.navigate('WorkerLeave')} hitSlop={8}>
                  <Text style={styles.leaveApply}>{t('apply_arrow')}</Text>
                </Pressable>
              </View>
              <Text style={styles.benefitSub}>{t('leave_annual_note')}</Text>
              {worker.loyalty_bonus_eligible && (
                <View style={styles.loyaltyStrip}>
                  <Text style={styles.loyaltyText}>{t('loyalty_bonus')}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* Service zone / mobility status bar */}
        <View style={styles.zoneBar}>
          <View style={styles.zoneItem}>
            <MapPin size={15} color={colors.primary600} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.zoneLabel}>{t('your_service_zone')}</Text>
              <Text style={styles.zoneValue} numberOfLines={1}>
                Tier {worker.tier?.replace('tier', '') || '2'} •{' '}
                {worker.tier === 'tier1' ? t('premium_zone') : worker.tier === 'tier2' ? t('standard_zone') : t('rural_zone')}
              </Text>
            </View>
          </View>
          <View style={styles.zoneDivider} />
          <View style={styles.zoneItem}>
            <Bike size={15} color={colors.accent600} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.zoneLabel}>{t('mobility')}</Text>
              <Text style={styles.zoneValue}>{t('coop_support')}</Text>
            </View>
            <Badge variant="primary" size="sm">{t('active')}</Badge>
          </View>
        </View>

        {/* Active job */}
        {activeBooking && (
          <View style={styles.section}>
            <SectionHeader title={t('active_job')} />
            <View style={styles.activeJobCard}>
              <View style={styles.activeJobAccent} />
              <View style={styles.activeJobBody}>
                <View style={styles.activeJobTop}>
                  <View style={styles.activeJobTitleWrap}>
                    <Text style={styles.activeJobTitle} numberOfLines={1}>{activeBooking.serviceName}</Text>
                    <Badge variant={activeBooking.status === 'completed' ? 'completed' : 'in-progress'} size="sm">
                      {activeBooking.status.replace('-', ' ')}
                    </Badge>
                  </View>
                  <Text style={styles.activeJobPrice}>₹{activeBooking.totalPrice}</Text>
                </View>
                <Text style={styles.activeJobDesc} numberOfLines={3}>{activeBooking.description}</Text>

                {/* Customer / Location / Scheduled grid */}
                <View style={styles.activeJobGrid}>
                  <View style={styles.activeJobGridItem}>
                    <View style={styles.activeJobGridHead}>
                      <UserRound size={12} color={colors.gray400} strokeWidth={2} />
                      <Text style={styles.activeJobGridLabel}>{t('customer_label')}</Text>
                    </View>
                    <Text style={styles.activeJobGridValue} numberOfLines={1}>{activeBooking.customerName}</Text>
                  </View>
                  <View style={styles.activeJobGridDivider} />
                  <View style={styles.activeJobGridItem}>
                    <View style={styles.activeJobGridHead}>
                      <MapPin size={12} color={colors.gray400} strokeWidth={2} />
                      <Text style={styles.activeJobGridLabel}>{t('location')}</Text>
                    </View>
                    <Text style={styles.activeJobGridValue} numberOfLines={1}>{activeBooking.address.split(',')[0]}</Text>
                  </View>
                  <View style={styles.activeJobGridDivider} />
                  <View style={styles.activeJobGridItem}>
                    <View style={styles.activeJobGridHead}>
                      <CalendarClock size={12} color={colors.gray400} strokeWidth={2} />
                      <Text style={styles.activeJobGridLabel}>{t('scheduled')}</Text>
                    </View>
                    <Text style={styles.activeJobGridValue} numberOfLines={1}>{activeBooking.time}</Text>
                  </View>
                </View>

                {/* Job progress stepper (from existing status only) */}
                {activeStep >= 0 ? (
                  <View style={styles.jobStepper}>
                    {JOB_LIFECYCLE.map((label, i) => {
                      const done = i <= activeStep;
                      return (
                        <View key={label} style={styles.jobStepSeg}>
                          <View style={styles.jobStepLine}>
                            {i > 0 ? <View style={[styles.jobConnector, i <= activeStep && styles.jobConnectorDone]} /> : <View style={styles.jobConnectorSpacer} />}
                            <View style={[styles.jobStepDot, done && styles.jobStepDotDone]}>
                              {done ? <Check size={9} color={colors.white} strokeWidth={3} /> : null}
                            </View>
                            {i < JOB_LIFECYCLE.length - 1 ? <View style={[styles.jobConnector, i < activeStep && styles.jobConnectorDone]} /> : <View style={styles.jobConnectorSpacer} />}
                          </View>
                          <Text style={[styles.jobStepLabel, done && styles.jobStepLabelDone]} numberOfLines={1}>{label}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        )}

        {/* Training CTA */}
        <Pressable
          style={({ pressed }) => [styles.trainingCta, pressed && styles.trainingPressed]}
          onPress={() => navigation.navigate('WorkerTraining')}
        >
          <View style={styles.trainingIcon}>
            <BookOpen size={22} color={colors.white} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.trainingTitle}>{t('free_training_available')}</Text>
            <Text style={styles.trainingSub}>{t('free_training_desc')}</Text>
          </View>
          <View style={styles.freeBadge}>
            <Text style={styles.freeBadgeText}>{t('free')}</Text>
          </View>
        </Pressable>

        {/* Recent jobs */}
        <View style={styles.section}>
          <SectionHeader title={t('recent_jobs')} />
          {bookings.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('no_job_history')}</Text>
            </View>
          ) : (
            <View style={styles.recentList}>
              {bookings.slice(0, 5).map((b, i) => (
                <View key={b.id} style={[styles.recentItem, i > 0 && styles.recentItemBordered]}>
                  <View style={styles.recentDot} />
                  <View style={styles.recentInfo}>
                    <Text style={styles.recentName} numberOfLines={1}>{b.serviceName}</Text>
                    <Text style={styles.recentMeta} numberOfLines={1}>{b.date} • {b.customerName}</Text>
                  </View>
                  <View style={styles.recentRight}>
                    <Text style={styles.recentPrice}>₹{b.totalPrice}</Text>
                    <Badge variant={b.status === 'completed' ? 'completed' : 'default'} size="sm">
                      {b.status.replace('-', ' ')}
                    </Badge>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
        </>
        )}

        {/* Community brand message (presentation only) */}
        <View style={styles.communityStrip}>
          <Text style={styles.communityText}>{t('community_message')}</Text>
          <Text style={styles.communitySub}>{t('community_motto')}</Text>
        </View>
      </View>

      <HelplineModal isOpen={showHelpline} onClose={() => setShowHelpline(false)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  canvas: { backgroundColor: colors.bgPrimary },
  content: { paddingHorizontal: 0, paddingTop: 0 },

  // ---- Header ----
  headerBand: {
    borderBottomLeftRadius: radii.radius2xl,
    borderBottomRightRadius: radii.radius2xl,
    paddingHorizontal: spacing.space5,
    paddingBottom: spacing.space5,
    overflow: 'hidden',
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, flex: 1 },
  logoWrap: { width: 40, height: 40, borderRadius: radii.radiusMd, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logo: { width: 40, height: 40 },
  brandText: { flex: 1 },
  brandName: { fontSize: fontSizes.fsBase, color: colors.white, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold },
  brandRole: { fontSize: fontSizes.fsXs, color: 'rgba(255,255,255,0.85)', fontFamily: fontFamilies.interMedium },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  headerIconBtn: { width: 38, height: 38, borderRadius: radii.radiusFull, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  bellDot: { position: 'absolute', top: 9, right: 10, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.white },
  greetName: { fontSize: fontSizes.fs2xl, color: colors.white, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, marginTop: spacing.space4 },
  greetSub: { fontSize: fontSizes.fsSm, color: 'rgba(255,255,255,0.9)', fontFamily: fontFamilies.interRegular, marginTop: 2 },
  statusPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.space3,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.radiusFull,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  statusPillText: {
    fontSize: fontSizes.fsXs,
    color: colors.white,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
  },

  // ---- Body ----
  body: { paddingHorizontal: spacing.space4, paddingTop: spacing.space5 },
  section: { marginTop: spacing.space6 },

  setupCard: {
    flexDirection: 'row', gap: spacing.space3, marginBottom: spacing.space4, padding: spacing.space4,
    backgroundColor: colors.warning50, borderRadius: radii.radiusLg, borderLeftWidth: 4, borderLeftColor: colors.warning500,
  },
  setupTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  setupText: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, marginTop: 2 },

  // ---- Certificate under review ----
  reviewCard: {
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, padding: spacing.space5,
    borderWidth: 1.5, borderColor: colors.primary100, marginBottom: spacing.space4,
    alignItems: 'center', gap: spacing.space3, ...shadows.shadowSm,
  },
  reviewIcon: {
    width: 56, height: 56, borderRadius: radii.radiusFull, backgroundColor: colors.primary50,
    alignItems: 'center', justifyContent: 'center',
  },
  reviewTitle: {
    fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold,
    color: colors.gray900, textAlign: 'center',
  },
  reviewBody: {
    fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interRegular,
    textAlign: 'center', lineHeight: 20,
  },
  reviewMetaBox: {
    width: '100%', backgroundColor: colors.primary50, borderRadius: radii.radiusLg,
    padding: spacing.space3, borderWidth: 1, borderColor: colors.primary100, gap: 2,
  },
  reviewMetaLabel: {
    fontSize: 10, color: colors.primary700, fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  reviewMetaValue: {
    fontSize: fontSizes.fsSm, color: colors.gray900, fontFamily: fontFamilies.interMedium,
    marginBottom: spacing.space2,
  },
  // ---- Verification-under-process banner (worker is in the training programme) ----
  verifyingCard: {
    flexDirection: 'row',
    gap: spacing.space3,
    padding: spacing.space4,
    marginBottom: spacing.space4,
    backgroundColor: colors.warning50,
    borderRadius: radii.radiusXl,
    borderWidth: 1,
    borderColor: colors.warning200,
  },
  verifyingIcon: {
    width: 40, height: 40, borderRadius: radii.radiusFull,
    backgroundColor: colors.warning100, alignItems: 'center', justifyContent: 'center',
  },
  verifyingTitle: {
    fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold, color: colors.warning800,
  },
  verifyingBody: {
    fontSize: fontSizes.fsXs, color: colors.gray600,
    fontFamily: fontFamilies.interRegular, marginTop: 3, lineHeight: 17,
  },
  verifyingLockRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.space2 },
  verifyingLockText: {
    fontSize: fontSizes.fsXs, color: colors.warning700,
    fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, flexShrink: 1,
  },

  reviewLocked: {
    fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular,
    textAlign: 'center', lineHeight: 16,
  },

  // ---- Payment received notice ----
  paidCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    backgroundColor: colors.success50, borderRadius: radii.radiusXl, padding: spacing.space4,
    borderWidth: 1.5, borderColor: colors.success100, marginBottom: spacing.space4, ...shadows.shadowSm,
  },
  paidIcon: {
    width: 38, height: 38, borderRadius: radii.radiusFull, backgroundColor: colors.success100,
    alignItems: 'center', justifyContent: 'center',
  },
  paidTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.success700 },
  paidSub: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, marginTop: 2 },
  paidDismiss: {
    width: 32, height: 32, borderRadius: radii.radiusFull, backgroundColor: colors.surfaceWhite,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.success100,
  },

  // ---- Free offline training programme ----
  trainCard: {
    borderRadius: radii.radiusXl, padding: spacing.space4, borderWidth: 1.5,
    marginBottom: spacing.space4, gap: spacing.space3, ...shadows.shadowSm,
  },
  trainCardActive: { backgroundColor: colors.warning50, borderColor: colors.warning200 },
  trainCardDone: { backgroundColor: colors.success50, borderColor: colors.success100 },
  trainHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  trainIcon: {
    width: 38, height: 38, borderRadius: radii.radiusFull, backgroundColor: colors.warning100,
    alignItems: 'center', justifyContent: 'center',
  },
  trainIconDone: { backgroundColor: colors.success100 },
  trainTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.warning800 },
  trainTitleDone: { color: colors.success700 },
  trainSub: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, marginTop: 2, lineHeight: 16 },
  trainBarTrack: { height: 7, borderRadius: radii.radiusFull, backgroundColor: colors.warning100, overflow: 'hidden' },
  trainBarFill: { height: '100%', borderRadius: radii.radiusFull, backgroundColor: colors.warning500 },
  trainProgressText: { fontSize: fontSizes.fsXs, color: colors.warning800, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  trainNote: {
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusMd,
    paddingVertical: spacing.space2, paddingHorizontal: spacing.space3,
    borderWidth: 1, borderColor: colors.warning100,
  },
  trainNoteText: { fontSize: fontSizes.fsXs, color: colors.gray700, fontFamily: fontFamilies.interRegular, lineHeight: 16 },
  // ---- Read-only module checklist shown to the trainee ----
  modList: { gap: 6, marginTop: spacing.space3 },
  modRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  modDot: {
    width: 14, height: 14, borderRadius: radii.radiusFull,
    borderWidth: 1.5, borderColor: colors.gray300,
  },
  modName: { flex: 1, fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interRegular, color: colors.gray600 },
  modNameDone: { color: colors.gray900, fontFamily: fontFamilies.interMedium },
  modBy: { fontSize: 10, fontFamily: fontFamilies.interRegular, color: colors.gray400, maxWidth: 90 },
  trainerRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space2,
    marginTop: spacing.space3, paddingTop: spacing.space3,
    borderTopWidth: 1, borderTopColor: colors.gray100,
  },
  trainerText: { flex: 1, fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interMedium, color: colors.primary700 },

  trainBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.space2,
    paddingVertical: spacing.space3, borderRadius: radii.radiusMd, backgroundColor: colors.warning600,
  },
  trainBtnText: { color: colors.white, fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold },
  trainCertRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space2,
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusMd,
    paddingVertical: spacing.space2, paddingHorizontal: spacing.space3,
    borderWidth: 1, borderColor: colors.success100,
  },
  trainCertText: { flex: 1, fontSize: fontSizes.fsXs, color: colors.success700, fontFamily: fontFamilies.interMedium, lineHeight: 15 },

  // ---- Availability ----
  availCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, borderRadius: radii.radiusXl, padding: spacing.space4, borderWidth: 1.5, ...shadows.shadowSm },
  availOn: { backgroundColor: colors.success50, borderColor: colors.success100 },
  availOff: { backgroundColor: colors.surfaceWhite, borderColor: colors.gray200 },
  availLeave: { backgroundColor: colors.warning50, borderColor: colors.warning200 },
  availIcon: { width: 40, height: 40, borderRadius: radii.radiusFull, alignItems: 'center', justifyContent: 'center' },
  availIconOn: { backgroundColor: colors.success100 },
  availIconOff: { backgroundColor: colors.gray100 },
  availIconLeave: { backgroundColor: colors.warning100 },
  availInfo: { flex: 1 },
  availTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  availTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900, letterSpacing: 0.5 },
  availSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  toggle: { width: 52, height: 30, borderRadius: 15, padding: 3, justifyContent: 'center' },
  toggleOn: { backgroundColor: colors.success500 },
  toggleOff: { backgroundColor: colors.gray300 },
  toggleLocked: { opacity: 0.45 },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.white, ...shadows.shadowSm },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },

  // ---- Performance ----
  perfCard: { backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, padding: spacing.space5, borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm },
  earnRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  earnIcon: { width: 44, height: 44, borderRadius: radii.radiusMd, backgroundColor: colors.success50, alignItems: 'center', justifyContent: 'center' },
  earnLabel: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interMedium, textTransform: 'uppercase', letterSpacing: 0.3 },
  earnValue: { fontSize: fontSizes.fs3xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900 },
  perfDivider: { height: 1, backgroundColor: colors.gray100, marginVertical: spacing.space4 },
  perfMetrics: { flexDirection: 'row', alignItems: 'stretch' },
  perfMetric: { flex: 1, alignItems: 'center', gap: spacing.space1 },
  perfMetricHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  perfMetricLabel: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interMedium },
  perfMetricValue: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900 },
  perfMetricValueRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  perfMetricDivider: { width: 1, backgroundColor: colors.gray100, marginHorizontal: spacing.space2 },

  // ---- Benefits rings ----
  ringRow: { flexDirection: 'row', gap: spacing.space3 },
  ringCard: { flex: 1, backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, padding: spacing.space4, borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm, alignItems: 'center' },
  ringTitle: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: spacing.space3, textAlign: 'center' },
  ringValue: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900 },
  ringMax: { fontSize: fontSizes.fsXs, color: colors.gray400, fontFamily: fontFamilies.interRegular, marginTop: -2 },
  ringCaption: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, marginTop: spacing.space3, textAlign: 'center' },
  ringSub: { fontSize: 11, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2, textAlign: 'center' },
  ringEmpty: { height: 110, alignItems: 'center', justifyContent: 'center' },

  // ---- Benefit cards ----
  benefitCard: { flexDirection: 'row', gap: spacing.space3, backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space4, borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm, marginTop: spacing.space3 },
  benefitCardActive: { borderColor: colors.success100, backgroundColor: colors.success50 },
  benefitIcon: { width: 40, height: 40, borderRadius: radii.radiusMd, alignItems: 'center', justifyContent: 'center' },
  benefitLabel: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interMedium, textTransform: 'uppercase', letterSpacing: 0.3 },
  benefitValue: { fontSize: fontSizes.fsLg, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900, marginVertical: 2 },
  benefitValueSmall: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwNormal, fontFamily: fontFamilies.interRegular, color: colors.gray400 },
  benefitSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2 },
  leaveHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  leaveApply: { fontSize: fontSizes.fsSm, color: colors.primary600, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold },
  loyaltyStrip: { marginTop: spacing.space2, backgroundColor: colors.accent50, borderRadius: radii.radiusMd, paddingVertical: 5, paddingHorizontal: 10, alignSelf: 'flex-start' },
  loyaltyText: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.accent700 },

  // ---- Zone bar ----
  zoneBar: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.space4, backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space4, borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm },
  zoneItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  zoneDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.gray100, marginHorizontal: spacing.space3 },
  zoneLabel: { fontSize: 10, color: colors.gray400, fontFamily: fontFamilies.interMedium, textTransform: 'uppercase', letterSpacing: 0.3 },
  zoneValue: { fontSize: fontSizes.fsXs, color: colors.gray800, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, marginTop: 1 },

  // ---- Active job ----
  activeJobCard: { flexDirection: 'row', backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, overflow: 'hidden', borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowMd },
  activeJobAccent: { width: 4, backgroundColor: colors.accent500 },
  activeJobBody: { flex: 1, padding: spacing.space4 },
  activeJobTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.space3, marginBottom: spacing.space2 },
  activeJobTitleWrap: { flex: 1, gap: 4, alignItems: 'flex-start' },
  activeJobPrice: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900 },
  activeJobTitle: { fontSize: fontSizes.fsLg, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  activeJobDesc: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interRegular, marginTop: 2, lineHeight: fontSizes.fsSm * 1.4 },
  activeJobGrid: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.space4, backgroundColor: colors.gray50, borderRadius: radii.radiusMd, paddingVertical: spacing.space3, paddingHorizontal: spacing.space3 },
  activeJobGridItem: { flex: 1, gap: 3 },
  activeJobGridDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.gray200, marginHorizontal: spacing.space2 },
  activeJobGridHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activeJobGridLabel: { fontSize: 10, color: colors.gray400, fontFamily: fontFamilies.interMedium, textTransform: 'uppercase', letterSpacing: 0.3 },
  activeJobGridValue: { fontSize: fontSizes.fsSm, color: colors.gray900, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  jobStepper: { flexDirection: 'row', marginTop: spacing.space4 },
  jobStepSeg: { flex: 1, alignItems: 'center' },
  jobStepLine: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  jobConnector: { flex: 1, height: 2, backgroundColor: colors.gray200 },
  jobConnectorDone: { backgroundColor: colors.accent500 },
  jobConnectorSpacer: { flex: 1 },
  jobStepDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.gray300, backgroundColor: colors.surfaceWhite, alignItems: 'center', justifyContent: 'center' },
  jobStepDotDone: { backgroundColor: colors.accent500, borderColor: colors.accent500 },
  jobStepLabel: { fontSize: 9.5, color: colors.gray400, fontFamily: fontFamilies.interMedium, marginTop: 4 },
  jobStepLabelDone: { color: colors.accent700, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },

  // ---- Training ----
  trainingCta: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, marginTop: spacing.space6, backgroundColor: colors.primary700, borderRadius: radii.radiusXl, padding: spacing.space4, ...shadows.shadowLg, shadowColor: colors.primary900 },
  trainingPressed: { opacity: 0.94 },
  trainingIcon: { width: 44, height: 44, borderRadius: radii.radiusMd, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  trainingTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },
  trainingSub: { fontSize: fontSizes.fsXs, color: colors.primary200, fontFamily: fontFamilies.interRegular, marginTop: 2 },
  freeBadge: { backgroundColor: colors.success500, borderRadius: radii.radiusFull, paddingVertical: 5, paddingHorizontal: 14 },
  freeBadgeText: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },

  // ---- Recent jobs ----
  emptyCard: { backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space6, alignItems: 'center', borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm },
  emptyText: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.interRegular, textAlign: 'center' },
  recentList: { backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, paddingHorizontal: spacing.space4, borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm },
  recentItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space3 },
  recentItemBordered: { borderTopWidth: 1, borderTopColor: colors.gray100 },
  recentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent400 },
  recentInfo: { flex: 1 },
  recentName: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.gray900 },
  recentMeta: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2 },
  recentRight: { alignItems: 'flex-end', gap: 4 },
  recentPrice: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },

  // ---- Community ----
  communityStrip: { marginTop: spacing.space6, alignItems: 'center', paddingVertical: spacing.space4 },
  communityText: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, textAlign: 'center' },
  communitySub: { fontSize: fontSizes.fsXs, color: colors.gray400, fontFamily: fontFamilies.interRegular, marginTop: 2 },
});
