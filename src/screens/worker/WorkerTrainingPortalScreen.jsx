import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { BookOpen, Play, CheckCircle, Clock, MapPin, Award, FileText, WifiOff, Users, GraduationCap } from 'lucide-react-native';
import { ScreenContainer } from '@components/app';
import { Chip, ChipRow } from '@components/app';
import Badge from '@components/ui/Badge';
import TraineeProgressSheet from '@components/app/TraineeProgressSheet';
import { useAuth } from '@context/AuthContext';
import { useLanguage } from '@context/LanguageContext';
import {
  useWorkerRegistration,
  canTrain,
  getTraineesForTrainer,
  trainingModules,
  MARKED_BY_TRAINER,
} from '@data/workerRegistration';
import { buildWorkerData } from '@screens/worker/workerData';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * WorkerTrainingPortalScreen — two sections:
 *
 * 1. MENTORSHIP (if the worker is verified): their assigned trainees + the unassigned pool.
 *    Tapping a trainee opens the module checklist. This is what turns the free-offline-training
 *    programme into something auditable — a trainee cannot self-certify, so verified workers
 *    assess them.
 *
 * 2. COURSE CATALOGUE: optional upskilling courses (plumbing → electrical, etc), independent of
 *    the gating programme. Preserved from the web portal verbatim. The catalogue and the mentorship
 *    section have nothing to do with each other — one is optional learning, the other is fulfilling
 *    a cooperative duty.
 */

// Course titles are referenced by translation key (titleKey) and resolved via t() at render time,
// so a card shows ONE localized title instead of the previous English + Hindi lines stacked
// together. The 'center' names are proper nouns (Seva Kendra locations) and stay as-is.
const COURSES = [
  { id: 1, titleKey: 'course_plumbing', duration: '40 hrs', level: 'Beginner', type: 'offline', center: 'Delhi Seva Kendra, Rohini', enrolled: true, progress: 65, modules: 12, completed: 8, cert: false, icon: '🔧', color: '#3b82f6' },
  { id: 2, titleKey: 'course_electrical', duration: '50 hrs', level: 'Beginner', type: 'hybrid', center: 'Gurugram ITI Campus', enrolled: false, progress: 0, modules: 15, completed: 0, cert: false, icon: '⚡', color: '#f59e0b' },
  { id: 3, titleKey: 'course_ac', duration: '60 hrs', level: 'Intermediate', type: 'offline', center: 'NSDC Partner Center, Noida', enrolled: false, progress: 0, modules: 18, completed: 0, cert: false, icon: '❄️', color: '#06b6d4' },
  { id: 4, titleKey: 'course_cleaning', duration: '20 hrs', level: 'Beginner', type: 'online', center: 'Online Only', enrolled: true, progress: 100, modules: 8, completed: 8, cert: true, icon: '🧹', color: '#10b981' },
  { id: 5, titleKey: 'course_carpentry', duration: '45 hrs', level: 'Beginner', type: 'offline', center: 'Jaipur Skill Hub', enrolled: false, progress: 0, modules: 14, completed: 0, cert: false, icon: '🔨', color: '#ef4444' },
];

const SEVA_KENDRAS = [
  { city: 'Delhi', address: 'Rohini Sector 15, Delhi - 110085', phone: '011-XXXX-XXXX', open: 'Mon–Sat 9AM–6PM' },
  { city: 'Gurugram', address: 'DLF Phase 2, Gurugram - 122002', phone: '0124-XXXX-XXXX', open: 'Mon–Sat 9AM–6PM' },
  { city: 'Noida', address: 'Sector 18, Noida - 201301', phone: '0120-XXXX-XXXX', open: 'Mon–Sat 9AM–6PM' },
  { city: 'Jaipur', address: 'Malviya Nagar, Jaipur - 302017', phone: '0141-XXXX-XXXX', open: 'Mon–Sat 9AM–5PM' },
];

const TYPE_LABELS = { offline: '🏢 Offline', hybrid: '🔀 Hybrid', online: '💻 Online' };
const LEVEL_VARIANTS = { Beginner: 'success', Intermediate: 'warning', Advanced: 'danger' };
const FILTERS = ['all', 'enrolled', 'offline', 'online', 'hybrid'];

export default function WorkerTrainingPortalScreen() {
  const { user, profile, workerProfile } = useAuth();
  const { t } = useLanguage();
  useWorkerRegistration(user?.email);

  const worker = buildWorkerData(user, profile, workerProfile);
  const isTrainer = canTrain(worker);

  const [filter, setFilter] = useState('all');
  const [enrolling, setEnrolling] = useState(null);
  const [courses, setCourses] = useState(COURSES);

  /**
   * Trainees ASSIGNED TO THIS WORKER by the cooperative admin. Read-only allocation.
   *
   * THE UNASSIGNED POOL HAS BEEN REMOVED FROM THIS SCREEN. It used to list every trainee nobody had
   * picked up, with a "Pick up" action that self-assigned the tapping worker as their trainer. Two
   * things were wrong with that:
   *
   *   1. The pool included the VIEWING WORKER themselves, so a trainee could tap their own row and
   *      become their own mentor — then tick off their own modules and certify themselves as
   *      employable. That is exactly the self-certification this programme exists to prevent, and it
   *      was observed in the field ("Your trainer: <own name>", modules signed by the trainee).
   *   2. Even between two different workers, letting mentors self-select their trainees is an
   *      allocation decision that belongs to the cooperative, not to whoever opens the tab first.
   *
   * Assignment is now solely the admin's responsibility, via the Training Oversight screen. The data
   * layer refuses self-assignment independently (see assignTrainer), so removing the UI is defence in
   * depth rather than the only guard.
   */
  const myTrainees = isTrainer ? getTraineesForTrainer(user?.email) : [];
  const [selectedTrainee, setSelectedTrainee] = useState(null);

  const handleEnroll = (id) => {
    setEnrolling(id);
    setTimeout(() => {
      setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, enrolled: true } : c)));
      setEnrolling(null);
    }, 1500);
  };

  const filtered =
    filter === 'all' ? courses : filter === 'enrolled' ? courses.filter((c) => c.enrolled) : courses.filter((c) => c.type === filter);

  const enrolledCount = courses.filter((c) => c.enrolled).length;
  const certCount = courses.filter((c) => c.cert).length;
  const avgProgress = Math.round(
    courses.filter((c) => c.enrolled).reduce((a, c) => a + c.progress, 0) / Math.max(enrolledCount, 1),
  );

  return (
    <>
      <ScreenContainer>
      {/* ---- Mentorship section: visible only to verified workers ---- */}
      {isTrainer && (
        <View style={styles.mentorSection}>
          <View style={styles.mentorHead}>
            <Users size={20} color={colors.primary700} strokeWidth={2.2} />
            <Text style={styles.mentorTitle}>{t('training_your_trainees')}</Text>
          </View>

          {myTrainees.length === 0 ? (
            <View style={styles.emptyState}>
              <GraduationCap size={32} color={colors.gray300} strokeWidth={2} />
              <Text style={styles.emptyText}>{t('training_no_trainees_yet')}</Text>
            </View>
          ) : (
            <View style={styles.traineeGroup}>
              <Text style={styles.groupLabel}>{t('training_assigned_to_you')}</Text>
              {myTrainees.map((tr) => (
                <TraineeCard key={tr.email} trainee={tr} onPress={() => setSelectedTrainee(tr)} t={t} />
              ))}
            </View>
          )}
        </View>
      )}

      {/* ---- Course catalogue (original portal content) ---- */}
      <View style={isTrainer && styles.catalogueSpacer}>
        <Text style={styles.h1}>🎓 {t('training_portal')}</Text>
        <Text style={styles.sub}>{t('skill_development')}</Text>
      </View>

      <View style={styles.internBadge}>
        <Award size={14} color={colors.warning800} />
        <Text style={styles.internText}>{t('internship_program')}</Text>
      </View>

      {/* Offline indicator (preserved from web WifiOff affordance) */}
      <View style={styles.offlineRow}>
        <WifiOff size={13} color={colors.gray400} />
        <Text style={styles.offlineText}>{t('offline_note')}</Text>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <Stat value={enrolledCount} label={t('enrolled')} />
        <Stat value={certCount} label={t('certificates')} />
        <Stat value={`${avgProgress}%`} label={t('avg_progress')} />
      </View>

      {/* Filters */}
      <ChipRow contentStyle={{ marginTop: spacing.space4, marginBottom: spacing.space4 }}>
        {FILTERS.map((f) => (
          <Chip
            key={f}
            label={f === 'all' ? t('all_courses') : f === 'enrolled' ? t('my_courses') : TYPE_LABELS[f] || f}
            selected={filter === f}
            onPress={() => setFilter(f)}
          />
        ))}
      </ChipRow>

      {/* Course cards */}
      <View style={styles.courseList}>
        {filtered.map((course) => (
          <View key={course.id} style={[styles.courseCard, course.enrolled && styles.courseEnrolled]}>
            <View style={styles.courseHeader}>
              <View style={[styles.courseIcon, { backgroundColor: course.color + '1A' }]}>
                <Text style={styles.courseEmoji}>{course.icon}</Text>
              </View>
              <View style={styles.courseBadges}>
                <Badge variant={LEVEL_VARIANTS[course.level]} size="sm">{course.level}</Badge>
                <Badge variant="default" size="sm">{TYPE_LABELS[course.type]}</Badge>
              </View>
            </View>

            <Text style={styles.courseTitle}>{t(course.titleKey)}</Text>

            <View style={styles.courseMeta}>
              <View style={styles.metaItem}><Clock size={12} color={colors.gray400} /><Text style={styles.metaText}>{course.duration}</Text></View>
              <View style={styles.metaItem}><BookOpen size={12} color={colors.gray400} /><Text style={styles.metaText}>{course.modules} {t('modules')}</Text></View>
              {course.type !== 'online' && (
                <View style={styles.metaItem}><MapPin size={12} color={colors.gray400} /><Text style={styles.metaText} numberOfLines={1}>{course.center}</Text></View>
              )}
            </View>

            {course.enrolled && (
              <View style={styles.progressWrap}>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${course.progress}%`, backgroundColor: course.color }]} />
                </View>
                <Text style={styles.progressText}>{course.progress}% • {course.completed}/{course.modules} {t('modules_lc')}</Text>
              </View>
            )}

            {course.cert && (
              <View style={styles.certEarned}>
                <CheckCircle size={14} color={colors.success600} />
                <Text style={styles.certEarnedText}>{t('cert_earned')}</Text>
              </View>
            )}

            <View style={styles.courseActions}>
              {course.enrolled ? (
                <Pressable style={[styles.enrollBtn, { backgroundColor: course.color }]}>
                  <Play size={15} color={colors.white} />
                  <Text style={styles.enrollBtnText}>{course.progress === 100 ? t('review') : t('continue_arrow')}</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.enrollBtn} onPress={() => handleEnroll(course.id)} disabled={enrolling === course.id}>
                  {enrolling === course.id ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <Text style={styles.enrollBtnText}>{t('enroll_free')}</Text>
                  )}
                </Pressable>
              )}
              <Pressable style={styles.syllabusBtn}>
                <FileText size={15} color={colors.gray600} />
                <Text style={styles.syllabusText}>{t('syllabus')}</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {/* Seva Kendras */}
      <View style={styles.kendraSection}>
        <Text style={styles.kendraTitle}>🏢 {t('nearest_kendras')}</Text>
        <Text style={styles.sub}>{t('kendra_sub')}</Text>
        <View style={styles.kendraList}>
          {SEVA_KENDRAS.map((k) => (
            <View key={k.city} style={styles.kendraCard}>
              <Text style={styles.kendraCity}>{k.city}</Text>
              <View style={styles.kendraRow}><MapPin size={12} color={colors.gray400} /><Text style={styles.kendraText}>{k.address}</Text></View>
              <Text style={styles.kendraText}>📞 {k.phone}</Text>
              <View style={styles.kendraRow}><Clock size={12} color={colors.gray400} /><Text style={styles.kendraText}>{k.open}</Text></View>
            </View>
          ))}
        </View>
      </View>
    </ScreenContainer>

    {/* The trainee module checklist: same component the admin uses, attribution is MARKED_BY_TRAINER */}
    <TraineeProgressSheet
      isOpen={!!selectedTrainee}
      onClose={() => setSelectedTrainee(null)}
      trainee={selectedTrainee}
      markedBy={{
        email: user?.email,
        name: profile?.full_name || user?.email,
        role: MARKED_BY_TRAINER,
      }}
    />
    </>
  );
}

/** A trainee card in the mentor section: shows progress, opens the module checklist on tap. */
function TraineeCard({ trainee, unassigned, onPress, t }) {
  const modules = trainingModules(trainee);
  const done = modules.filter((m) => m.done).length;
  const total = modules.length;
  const pct = Math.round((done / total) * 100);

  return (
    <Pressable
      style={({ pressed }) => [styles.traineeCard, unassigned && styles.traineeCardUnassigned, pressed && styles.traineeCardPressed]}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.traineeEmail} numberOfLines={1}>
          {trainee.email}
        </Text>
        <View style={styles.traineeBar}>
          <View style={[styles.traineeBarFill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.traineeMeta}>
          {t('training_modules_progress', { done, total })}
        </Text>
      </View>
      {unassigned && (
        <View style={styles.pickUpBadge}>
          <Text style={styles.pickUpText}>{t('training_pick_up')}</Text>
        </View>
      )}
    </Pressable>
  );
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ---- Mentorship section ----
  mentorSection: {
    backgroundColor: colors.primary50,
    borderRadius: radii.radiusXl,
    padding: spacing.space4,
    marginBottom: spacing.space5,
    borderWidth: 1,
    borderColor: colors.primary100,
  },
  mentorHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    marginBottom: spacing.space3,
  },
  mentorTitle: {
    fontSize: fontSizes.fsLg,
    fontFamily: fontFamilies.interBold,
    fontWeight: fontWeights.fwBold,
    color: colors.primary900,
  },
  traineeGroup: { marginTop: spacing.space3 },
  groupLabel: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    color: colors.gray700,
    marginBottom: spacing.space2,
  },
  unassignedHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, marginBottom: spacing.space2 },
  traineeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    backgroundColor: colors.white,
    borderRadius: radii.radiusLg,
    padding: spacing.space3,
    marginTop: spacing.space2,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  traineeCardUnassigned: { borderColor: colors.warning200, backgroundColor: '#fffbf5' },
  traineeCardPressed: { opacity: 0.7 },
  traineeEmail: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interMedium,
    color: colors.gray900,
    marginBottom: 4,
  },
  traineeBar: {
    height: 5,
    borderRadius: radii.radiusFull,
    backgroundColor: colors.gray200,
    overflow: 'hidden',
    marginBottom: 4,
  },
  traineeBarFill: { height: '100%', backgroundColor: colors.primary600, borderRadius: radii.radiusFull },
  traineeMeta: { fontSize: 10.5, fontFamily: fontFamilies.interRegular, color: colors.gray500 },
  pickUpBadge: {
    backgroundColor: colors.warning100,
    borderRadius: radii.radiusMd,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  pickUpText: {
    fontSize: 10,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    color: colors.warning700,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.space5,
    gap: spacing.space2,
  },
  emptyText: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
    textAlign: 'center',
  },
  catalogueSpacer: { marginTop: spacing.space4 },

  // ---- Course catalogue (original) ----
  h1: { fontSize: fontSizes.fs2xl, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  sub: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2 },
  internBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: spacing.space3, backgroundColor: colors.accent100, paddingVertical: 4, paddingHorizontal: 10, borderRadius: radii.radiusFull },
  internText: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.warning800 },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.space3 },
  offlineText: { fontSize: fontSizes.fsXs, color: colors.gray400, fontFamily: fontFamilies.interRegular },
  statsRow: { flexDirection: 'row', gap: spacing.space3, marginTop: spacing.space4 },
  stat: { flex: 1, backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space4, alignItems: 'center', ...shadows.shadowSm },
  statVal: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.accent600 },
  statLabel: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2, textAlign: 'center' },
  courseList: { gap: spacing.space3 },
  courseCard: { backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space4, ...shadows.shadowSm },
  courseEnrolled: { borderWidth: 1, borderColor: colors.accent200 },
  courseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.space2 },
  courseIcon: { width: 44, height: 44, borderRadius: radii.radiusMd, alignItems: 'center', justifyContent: 'center' },
  courseEmoji: { fontSize: 22 },
  courseBadges: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', flex: 1, marginLeft: spacing.space2 },
  courseTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  courseHindi: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.notoDevanagariRegular, marginBottom: spacing.space2 },
  courseMeta: { gap: 4, marginBottom: spacing.space2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, flexShrink: 1 },
  progressWrap: { marginTop: spacing.space2 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.gray200, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressText: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 4 },
  certEarned: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.space2, backgroundColor: colors.success50, borderRadius: radii.radiusMd, padding: spacing.space2 },
  certEarnedText: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.success700 },
  courseActions: { flexDirection: 'row', gap: spacing.space2, marginTop: spacing.space3 },
  enrollBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: radii.radiusMd, backgroundColor: colors.accent600 },
  enrollBtnText: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },
  syllabusBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.space3, height: 42, borderRadius: radii.radiusMd, borderWidth: 1.5, borderColor: colors.gray200 },
  syllabusText: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwMedium, fontFamily: fontFamilies.interMedium, color: colors.gray600 },
  kendraSection: { marginTop: spacing.space6 },
  kendraTitle: { fontSize: fontSizes.fsLg, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  kendraList: { gap: spacing.space3, marginTop: spacing.space3 },
  kendraCard: { backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space4, ...shadows.shadowSm },
  kendraCity: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900, marginBottom: 4 },
  kendraRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  kendraText: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, flexShrink: 1 },
});
