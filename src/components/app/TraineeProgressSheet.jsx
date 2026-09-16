import { View, Text, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { CheckCircle2, X as XIcon, Award, GraduationCap, UserCheck } from 'lucide-react-native';
import { useLanguage } from '@context/LanguageContext';
import {
  trainingModules,
  setModuleDone,
  completeTraining,
  TRAINING_MODULES,
  MARKED_BY_ADMIN,
} from '@data/workerRegistration';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * The trainee module checklist, used by BOTH the trainer (worker portal) and the admin.
 *
 * WHY SHARED: the two roles need identical information and near-identical controls — tick a module,
 * see who signed each one, sign off completion. Building it twice would guarantee the two views
 * drifted apart, and the admin's copy is the one that has to be trustworthy.
 *
 * The only behavioural difference is attribution: `markedBy.role` is stamped onto every tick, so the
 * log distinguishes a trainer's sign-off from an admin override. The admin also gets a slightly
 * blunter completion button, since an admin can finish a programme regardless of how many modules
 * are ticked (a Seva Kendra assessment held offline, say).
 *
 * Progress written here is immediately visible in the trainee's own portal — both read the same
 * record through useWorkerRegistration, so no explicit refresh is needed.
 */
export default function TraineeProgressSheet({ isOpen, onClose, trainee, markedBy }) {
  const { t } = useLanguage();

  if (!trainee) return null;

  const modules = trainingModules(trainee);
  const doneCount = modules.filter((m) => m.done).length;
  const total = TRAINING_MODULES.length;
  const allDone = doneCount === total;
  const isAdmin = markedBy?.role === MARKED_BY_ADMIN;
  const finished = trainee.training?.status === 'completed';

  const toggle = (m) => {
    if (finished) return;
    setModuleDone(trainee.email, m.index, !m.done, markedBy);
  };

  const signOff = () => {
    completeTraining(trainee.email, markedBy);
    onClose?.();
  };

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <View style={styles.headIcon}>
              <GraduationCap size={20} color={colors.primary700} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {trainee.email}
              </Text>
              <Text style={styles.subtitle}>
                {t('training_modules_progress', { done: doneCount, total })}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('cancel')}>
              <XIcon size={20} color={colors.gray500} />
            </Pressable>
          </View>

          {/* Who is mentoring this person. Unassigned trainees are the ones at risk of stalling. */}
          <View style={styles.trainerBar}>
            <UserCheck size={13} color={colors.gray600} strokeWidth={2.2} />
            <Text style={styles.trainerBarText} numberOfLines={1}>
              {trainee.training?.trainerName
                ? t('training_trainer_is', { name: trainee.training.trainerName })
                : t('training_no_trainer_yet')}
            </Text>
          </View>

          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${Math.round((doneCount / total) * 100)}%` }]} />
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {modules.map((m) => (
              <Pressable
                key={m.index}
                style={[styles.row, m.done && styles.rowDone, finished && styles.rowLocked]}
                onPress={() => toggle(m)}
                disabled={finished}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: m.done, disabled: finished }}
                accessibilityLabel={t(m.key)}
              >
                <View style={[styles.box, m.done && styles.boxOn]}>
                  {m.done && <CheckCircle2 size={14} color={colors.white} strokeWidth={2.6} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, m.done && styles.rowNameDone]}>{t(m.key)}</Text>
                  {m.done && m.byName ? (
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {t('training_signed_by', {
                        name: m.byName,
                        date: (m.at || '').split('T')[0] || '—',
                      })}
                    </Text>
                  ) : null}
                  {/* Legacy programmes carry a count but no attribution — say so rather than
                      implying somebody signed it. */}
                  {m.done && !m.byName ? (
                    <Text style={styles.rowMeta}>{t('training_signed_unknown')}</Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>

          {finished ? (
            <View style={styles.doneBanner}>
              <Award size={15} color={colors.success700} strokeWidth={2.3} />
              <Text style={styles.doneBannerText}>
                {trainee.training?.completedByName
                  ? t('training_completed_by', { name: trainee.training.completedByName })
                  : t('training_completed_title')}
              </Text>
            </View>
          ) : (
            <>
              <Pressable
                style={[styles.signOffBtn, !allDone && !isAdmin && styles.signOffBtnDisabled]}
                onPress={signOff}
                disabled={!allDone && !isAdmin}
              >
                <Award size={16} color={colors.white} strokeWidth={2.4} />
                <Text style={styles.signOffText}>{t('training_sign_off')}</Text>
              </Pressable>
              <Text style={styles.signOffHint}>
                {allDone
                  ? t('training_sign_off_ready')
                  : isAdmin
                    ? t('training_sign_off_admin_hint')
                    : t('training_sign_off_hint', { left: total - doneCount })}
              </Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.radius2xl,
    borderTopRightRadius: radii.radius2xl,
    padding: spacing.space5,
    paddingBottom: spacing.space6,
    gap: spacing.space3,
    maxHeight: '88%',
    ...shadows.shadowXl,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  headIcon: {
    width: 40, height: 40, borderRadius: radii.radiusFull,
    backgroundColor: colors.primary100, alignItems: 'center', justifyContent: 'center',
  },
  title: {
    fontSize: fontSizes.fsBase, fontFamily: fontFamilies.interBold,
    fontWeight: fontWeights.fwBold, color: colors.gray900,
  },
  subtitle: {
    fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interRegular,
    color: colors.gray500, marginTop: 1,
  },

  trainerBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space2,
    backgroundColor: colors.gray50, borderRadius: radii.radiusMd, padding: spacing.space2,
  },
  trainerBarText: {
    flex: 1, fontSize: fontSizes.fsXs,
    fontFamily: fontFamilies.interMedium, color: colors.gray700,
  },

  barTrack: { height: 6, borderRadius: radii.radiusFull, backgroundColor: colors.gray200, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radii.radiusFull, backgroundColor: colors.primary600 },

  list: { maxHeight: 340 },
  listContent: { gap: spacing.space2, paddingVertical: spacing.space1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    padding: spacing.space3, borderRadius: radii.radiusMd,
    borderWidth: 1, borderColor: colors.gray200, backgroundColor: colors.white,
  },
  rowDone: { borderColor: colors.success100, backgroundColor: colors.success50 },
  rowLocked: { opacity: 0.75 },
  box: {
    width: 22, height: 22, borderRadius: radii.radiusSm ?? 6,
    borderWidth: 1.5, borderColor: colors.gray300,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.success600, borderColor: colors.success600 },
  rowName: {
    fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interMedium, color: colors.gray700,
  },
  rowNameDone: { color: colors.gray900, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  rowMeta: { fontSize: 10.5, fontFamily: fontFamilies.interRegular, color: colors.gray500, marginTop: 2 },

  signOffBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.space2,
    backgroundColor: colors.success600, borderRadius: radii.radiusLg, paddingVertical: spacing.space4,
  },
  signOffBtnDisabled: { backgroundColor: colors.gray300 },
  signOffText: {
    fontSize: fontSizes.fsBase, fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold, color: colors.white,
  },
  signOffHint: {
    fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interRegular,
    color: colors.gray500, textAlign: 'center',
  },

  doneBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space2,
    backgroundColor: colors.success50, borderWidth: 1, borderColor: colors.success100,
    borderRadius: radii.radiusMd, padding: spacing.space3,
  },
  doneBannerText: {
    flex: 1, fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interMedium, color: colors.success800,
  },
});
