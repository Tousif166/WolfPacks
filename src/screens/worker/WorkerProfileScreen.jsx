import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import {
  Mail,
  Phone,
  Award,
  Calendar,
  Users,
  AlertCircle,
  LogOut,
  Star,
  BadgeCheck,
  Wrench,
  Globe,
  FileClock,
  GraduationCap,
} from 'lucide-react-native';
import { useAuth } from '@context/AuthContext';
import { useLanguage } from '@context/LanguageContext';
import { ScreenContainer } from '@components/app';
import LanguageToggle from '@components/ui/LanguageToggle';
import { LANGUAGES } from '@data/translations';
import AvatarPortrait from '@components/illustrations/AvatarPortrait';
import { useWorkerRegistration } from '@data/workerRegistration';
import { useWorkerStats } from '@data/workerStats';
import { useBookings } from '@data/mockBookings';
import { DEMO_WORKER_ID, demoMockWorker, buildWorkerData } from './workerData';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * WorkerProfileScreen — ported from web pages/worker/WorkerProfile.jsx. Demo-worker vs
 * real-worker data resolution preserved exactly (only 'demo-worker' maps to Suresh Kumar;
 * real workers use auth context only). Setup-pending notice for real workers with no
 * workerProfile.
 *
 * VISUAL REDESIGN (frontend-only — no data source, resolution rules, logout, or navigation
 * changed):
 *  - Premium page header ("My Profile" + supporting subtitle).
 *  - Hero identity card: warm peach-tinted surface, large circular avatar with a thin white
 *    ring + soft shadow, a green "Verified Worker" badge shown ONLY when the existing `verified`
 *    value is true, a profession line derived from the EXISTING skills array (no invented
 *    title), and a rating / jobs-completed / cooperative stat block from existing data.
 *  - "Personal Information" as one polished section with subtle row separators (not four cards).
 *  - "Skills" rendered as modern chips (fully dynamic — wraps for any count / length).
 *  - "Certificates" styled as professional credentials (icon + title + issuer·date). No
 *    "Verified" tag on certificates because the certificate data has no such field.
 *  - Logout demoted to a subtle outlined destructive action.
 *
 * OMITTED ON PURPOSE (data does not exist — per "omit rather than invent a backend field"):
 *  - Profile photo upload / image: the worker record's `avatar` is null and there is no image
 *    field, so the avatar falls back to the initial. An <Image> is still rendered IF an avatar
 *    URL ever exists on the existing profile objects — no new field is created.
 *  - "Edit Profile" button: no profile-editing feature exists, so no button is shown.
 *  - Per-certificate "Verified" status and skill proficiency levels: no such data exists.
 */
export default function WorkerProfileScreen() {
  const { user, profile, workerProfile, logout } = useAuth();
  const { resolvedLanguage, t } = useLanguage();
  const isDemo = user?.id === DEMO_WORKER_ID;
  const langLabel = LANGUAGES.find((l) => l.code === resolvedLanguage)?.label || 'English';

  /**
   * RESOLVED THROUGH buildWorkerData, not read from workerProfile directly.
   *
   * This screen used to read `workerProfile?.certificates`, `workerProfile?.verified` and
   * `workerProfile?.rating` straight from the auth context. Supabase has no columns for any of
   * those, so for a real worker they were permanently empty/false — an approved certificate never
   * showed up, the Verified badge never lit, and the rating/job count ignored every completed job.
   *
   * buildWorkerData is where registration certificates, the training certificate, the verified
   * derivation and the earnings/rating/job deltas are already merged (see workerData.js and
   * workerStats.js), which is what the dashboard has been using all along. Routing this screen
   * through the same function is what keeps the two in sync.
   */
  useWorkerRegistration(user?.email);
  useWorkerStats();
  useBookings();
  const worker = buildWorkerData(user, profile, workerProfile);

  const displayName = worker.name;
  const displayEmail = worker.email;
  const displayPhone = worker.phone;
  const cooperative = worker.cooperative;
  const joinDate = worker.joinDate;
  const skills = worker.skills || [];
  const certificates = worker.certificates || [];
  const rating = worker.rating;
  const totalJobs = worker.totalJobs;
  const isVerified = !!worker.verified;
  const training = worker.training;
  // Use an existing avatar URL if the profile ever provides one; otherwise the initial avatar.
  const avatarUrl = isDemo ? demoMockWorker.avatar : workerProfile?.avatar_url || user?.avatar || null;
  // Profession subtitle is just the existing skills, joined — not a fabricated job title.
  const professionLine = skills.length > 0 ? skills.join(' · ') : null;

  return (
    <ScreenContainer contentStyle={styles.pageContent}>
      {/* ---- Header ---- */}
      <Text style={styles.h1}>{t('my_profile')}</Text>
      <Text style={styles.h1Sub}>{t('manage_account')}</Text>

      {!isDemo && !workerProfile && (
        <View style={styles.setupCard}>
          <AlertCircle size={18} color={colors.warning500} />
          <View style={{ flex: 1 }}>
            <Text style={styles.setupTitle}>{t('setup_pending')}</Text>
            <Text style={styles.setupText}>{t('setup_pending_desc')}</Text>
          </View>
        </View>
      )}

      {/* ---- Premium identity hero ---- */}
      <View style={styles.hero}>
        {/* Subtle decorative tool glyph (low opacity, behind content, non-interactive). */}
        <Wrench size={128} color={colors.accent500} style={styles.heroDecor} pointerEvents="none" />

        <View style={styles.avatarWrap}>
          <View style={styles.avatarRing}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarImg}>
                <AvatarPortrait size={88} seed={user?.id || displayName} />
              </View>
            )}
          </View>
          {isVerified && (
            <View style={styles.verifyDot}>
              <BadgeCheck size={16} color={colors.white} strokeWidth={2.6} />
            </View>
          )}
        </View>

        <Text style={styles.name} numberOfLines={2}>{displayName}</Text>

        {isVerified && (
          <View style={styles.verifyPill}>
            <BadgeCheck size={13} color={colors.success700} strokeWidth={2.4} />
            <Text style={styles.verifyPillText}>{t('verified_workers')}</Text>
          </View>
        )}

        {professionLine && <Text style={styles.profession} numberOfLines={2}>{professionLine}</Text>}

        {/* Rating · jobs stat row (existing data only) */}
        <View style={styles.statRow}>
          <View style={styles.statCell}>
            {rating != null ? (
              <View style={styles.ratingWrap}>
                <Star size={16} color={colors.accent500} fill={colors.accent500} strokeWidth={0} />
                <Text style={styles.statValue}>{rating.toFixed(1)}</Text>
              </View>
            ) : (
              <Text style={styles.statValueMuted}>{t('not_rated')}</Text>
            )}
            <Text style={styles.statLabel}>{t('rating')}</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{totalJobs}</Text>
            <Text style={styles.statLabel}>{t('jobs_completed')}</Text>
          </View>
        </View>

        <View style={styles.coopRow}>
          <Users size={13} color={colors.accent700} strokeWidth={2.2} />
          <Text style={styles.coopText} numberOfLines={2}>{cooperative}</Text>
        </View>
      </View>

      {/* ---- Personal Information ---- */}
      <Text style={styles.sectionTitle}>{t('personal_information')}</Text>
      <View style={styles.card}>
        <InfoItem icon={Mail} label={t('email')} value={displayEmail} />
        <InfoItem icon={Phone} label={t('phone')} value={displayPhone} />
        <InfoItem icon={Users} label={t('cooperative')} value={cooperative} />
        <InfoItem icon={Calendar} label={t('joined')} value={joinDate} last />
      </View>

      {/* ---- Language (interactive — switches the app language app-wide) ---- */}
      <Text style={styles.sectionTitle}>{t('language')}</Text>
      <View style={styles.card}>
        <View style={styles.langRowTop}>
          <View style={styles.infoIcon}>
            <Globe size={18} color={colors.accent600} strokeWidth={2.1} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoLabel}>{t('language_sub')}</Text>
            <Text style={styles.infoValue}>{langLabel}</Text>
          </View>
        </View>
        <View style={styles.langToggleWrap}>
          {/* Same canonical control the customer profile and header use. */}
          <LanguageToggle size="md" />
        </View>
      </View>

      {/* ---- Skills ---- */}
      <Text style={styles.sectionTitle}>{t('skills')}</Text>
      <View style={styles.card}>
        {skills.length > 0 ? (
          <View style={styles.chipRow}>
            {skills.map((skill) => (
              <View key={skill} style={styles.chip}>
                <Wrench size={13} color={colors.accent700} strokeWidth={2.2} />
                <Text style={styles.chipText}>{skill}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.emptyText}>{t('no_skills')}</Text>
        )}
      </View>

      {/* ---- Certificates ---- */}
      <Text style={styles.sectionTitle}>{t('certificates')}</Text>
      <View style={styles.card}>
        {certificates.length > 0 ? (
          certificates.map((cert, i) => (
            <View key={i} style={[styles.certRow, i < certificates.length - 1 && styles.certRowBorder]}>
              <View style={styles.certIcon}>
                <Award size={20} color={colors.accent600} strokeWidth={2.1} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.certName} numberOfLines={2}>{cert.name}</Text>
                <Text style={styles.certMeta} numberOfLines={2}>{cert.issuer} · {cert.date}</Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.emptyText}>{t('no_certificates')}</Text>
        )}

        {/* Certificate still under admin review — explains an empty or short list above, so the
            worker is not left wondering where their upload went. */}
        {worker.certificatePending && (
          <View style={styles.pendingRow}>
            <FileClock size={16} color={colors.primary700} strokeWidth={2.3} />
            <Text style={styles.pendingText}>{t('cert_under_review_title')}</Text>
          </View>
        )}
      </View>

      {/* ---- Training programme — mirrors the dashboard so the two never disagree ---- */}
      {training && (
        <>
          <Text style={styles.sectionTitle}>{t('training')}</Text>
          <View style={styles.card}>
            <View style={styles.trainRow}>
              <View style={[styles.trainIcon, training.status === 'completed' && styles.trainIconDone]}>
                {training.status === 'completed' ? (
                  <BadgeCheck size={18} color={colors.success700} strokeWidth={2.3} />
                ) : (
                  <GraduationCap size={18} color={colors.warning700} strokeWidth={2.3} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.trainName}>
                  {t(training.status === 'completed' ? 'training_completed_title' : 'training_enrolled_title')}
                </Text>
                <Text style={styles.trainMeta}>
                  {training.status === 'completed'
                    ? t('training_cert_issued')
                    : t('training_modules_progress', {
                        done: training.modulesDone || 0,
                        total: training.modulesTotal || 8,
                      })}
                </Text>
              </View>
            </View>
          </View>
        </>
      )}

      {/* ---- Logout (subtle destructive) ---- */}
      <Pressable style={styles.logoutBtn} onPress={logout}>
        <LogOut size={16} color={colors.danger600} strokeWidth={2.2} />
        <Text style={styles.logoutText}>{t('log_out')}</Text>
      </Pressable>
    </ScreenContainer>
  );
}

function InfoItem({ icon: Icon, label, value, last }) {
  return (
    <View style={[styles.infoItem, !last && styles.infoItemBorder]}>
      <View style={styles.infoIcon}>
        <Icon size={18} color={colors.accent600} strokeWidth={2.1} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Clear the global Sahakar AI ChatWidget FAB (bottom: insets.bottom + 76, ~52 tall) so the
  // logout button and last card are never covered.
  pageContent: { paddingBottom: spacing.space16 },

  h1: { fontSize: fontSizes.fs3xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900, letterSpacing: -0.5 },
  h1Sub: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.interMedium, marginTop: 3, marginBottom: spacing.space5 },

  setupCard: { flexDirection: 'row', gap: spacing.space3, marginBottom: spacing.space4, padding: spacing.space4, backgroundColor: colors.warning50, borderRadius: radii.radiusLg, borderLeftWidth: 4, borderLeftColor: colors.warning500 },
  setupTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  setupText: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, marginTop: 2 },

  // ---- Hero ----
  hero: {
    alignItems: 'center',
    backgroundColor: colors.accent50,
    borderRadius: radii.radiusXl,
    borderWidth: 1,
    borderColor: colors.accent100,
    paddingVertical: spacing.space6,
    paddingHorizontal: spacing.space5,
    overflow: 'hidden',
    ...shadows.shadowMd,
  },
  heroDecor: { position: 'absolute', right: -28, top: -20, opacity: 0.08, transform: [{ rotate: '15deg' }] },

  avatarWrap: { marginBottom: spacing.space3 },
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.white,
    padding: 4,
    ...shadows.shadowLg,
    shadowColor: colors.accent600,
  },
  avatar: { flex: 1, borderRadius: 44, backgroundColor: colors.accent600, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { flex: 1, borderRadius: 44, backgroundColor: colors.accent100 },
  avatarText: { fontSize: fontSizes.fs3xl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.white },
  verifyDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.success600,
    borderWidth: 3,
    borderColor: colors.accent50,
    alignItems: 'center',
    justifyContent: 'center',
  },

  name: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900, textAlign: 'center' },
  verifyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.space2,
    paddingVertical: 3,
    paddingHorizontal: 10,
    backgroundColor: colors.success50,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: radii.radiusFull,
  },
  verifyPillText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, color: colors.success700 },
  profession: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interMedium, marginTop: spacing.space2, textAlign: 'center' },

  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
    marginTop: spacing.space4,
    paddingVertical: spacing.space3,
    backgroundColor: colors.white,
    borderRadius: radii.radiusLg,
    borderWidth: 1,
    borderColor: colors.accent100,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: spacing.space2 },
  ratingWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: fontSizes.fsLg, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900 },
  statValueMuted: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.gray400 },
  statLabel: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interMedium, textAlign: 'center' },
  statSep: { width: 1, alignSelf: 'stretch', marginVertical: spacing.space1, backgroundColor: colors.accent100 },

  coopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.space3, paddingHorizontal: spacing.space2 },
  coopText: { fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, color: colors.accent700, flexShrink: 1, textAlign: 'center' },

  // ---- Sections / cards ----
  sectionTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900, marginTop: spacing.space6, marginBottom: spacing.space3 },
  card: { backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space4, borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm },

  infoItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space3 },
  infoItemBorder: { borderBottomWidth: 1, borderBottomColor: colors.gray100 },
  infoIcon: { width: 40, height: 40, borderRadius: radii.radiusMd, backgroundColor: colors.accent50, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontSize: fontSizes.fsXs, color: colors.gray400, fontFamily: fontFamilies.interMedium },
  infoValue: { fontSize: fontSizes.fsSm, color: colors.gray900, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, marginTop: 1 },

  langRowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingBottom: spacing.space3, borderBottomWidth: 1, borderBottomColor: colors.gray100 },
  langToggleWrap: { paddingTop: spacing.space3 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: spacing.space3,
    backgroundColor: colors.accent50,
    borderWidth: 1,
    borderColor: colors.accent100,
    borderRadius: radii.radiusFull,
  },
  chipText: { fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, color: colors.accent700 },
  emptyText: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.interRegular, lineHeight: 20 },

  certRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space3 },
  certRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.gray100 },

  /* Certificate awaiting admin review */
  pendingRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space2,
    marginTop: spacing.space3, paddingTop: spacing.space3,
    borderTopWidth: 1, borderTopColor: colors.gray100,
  },
  pendingText: { flex: 1, fontSize: fontSizes.fsXs, color: colors.primary700, fontFamily: fontFamilies.interMedium, lineHeight: 16 },

  /* Training programme row (mirrors the dashboard card) */
  trainRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space2 },
  trainIcon: {
    width: 40, height: 40, borderRadius: radii.radiusMd, backgroundColor: colors.warning50,
    alignItems: 'center', justifyContent: 'center',
  },
  trainIconDone: { backgroundColor: colors.success50 },
  trainName: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  trainMeta: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, marginTop: 1, lineHeight: 16 },
  certIcon: { width: 40, height: 40, borderRadius: radii.radiusMd, backgroundColor: colors.accent50, alignItems: 'center', justifyContent: 'center' },
  certName: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  certMeta: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2 },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.space2,
    height: 48,
    marginTop: spacing.space6,
    borderRadius: radii.radiusMd,
    borderWidth: 1,
    borderColor: colors.danger200,
    backgroundColor: colors.surfaceWhite,
  },
  logoutText: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.danger600 },
});
