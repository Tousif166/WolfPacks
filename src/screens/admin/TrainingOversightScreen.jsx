import { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { GraduationCap, Users, CheckCircle, AlertCircle, UserCheck, ChevronRight } from 'lucide-react-native';
import { ScreenContainer } from '@components/app';
import TraineeProgressSheet from '@components/app/TraineeProgressSheet';
import { useLanguage } from '@context/LanguageContext';
import { useAuth } from '@context/AuthContext';
import {
  useWorkerRegistration,
  getTrainees,
  trainingModules,
  assignTrainer,
  MARKED_BY_ADMIN,
} from '@data/workerRegistration';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * Admin training oversight — the cooperative's view of the entire programme.
 *
 * WHY THIS EXISTS: a trainee cannot self-certify, and a trainer's sign-off is only as trustworthy
 * as that trainer's own credentials. The admin is the final backstop: they see every trainee, what
 * each has been signed off on, who their trainer is (or that nobody has picked them up yet), and
 * can mark progress or sign off completion directly — useful for offline assessments held at a Seva
 * Kendra where neither the trainee nor the trainer is present to use the app.
 *
 * This screen and the worker's Training tab use the SAME module checklist component
 * (TraineeProgressSheet), so the data they see is identical. The only difference is attribution:
 * ticks marked here are stamped MARKED_BY_ADMIN rather than MARKED_BY_TRAINER.
 */
export default function TrainingOversightScreen() {
  const { t } = useLanguage();
  const { profile } = useAuth();
  useWorkerRegistration();

  const trainees = getTrainees();
  const [selectedTrainee, setSelectedTrainee] = useState(null);
  const [assignOpen, setAssignOpen] = useState(null);
  const [filter, setFilter] = useState('all');

  const unassigned = trainees.filter((tr) => !tr.training?.trainerEmail);
  const stalled = trainees.filter((tr) => {
    const modules = trainingModules(tr);
    const done = modules.filter((m) => m.done).length;
    return done < modules.length * 0.5; // Less than halfway
  });

  const filtered =
    filter === 'all'
      ? trainees
      : filter === 'unassigned'
        ? unassigned
        : filter === 'stalled'
          ? stalled
          : trainees;

  return (
    <ScreenContainer>
      <View style={styles.head}>
        <GraduationCap size={28} color={colors.primary700} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t('admin_training_oversight')}</Text>
          <Text style={styles.subtitle}>{t('admin_training_oversight_sub')}</Text>
        </View>
      </View>

      {/* High-level stats: how many total, unassigned, stalled */}
      <View style={styles.statsRow}>
        <StatCard value={trainees.length} label={t('training_total')} icon={Users} color={colors.primary600} />
        <StatCard
          value={unassigned.length}
          label={t('training_unassigned')}
          icon={AlertCircle}
          color={unassigned.length > 0 ? colors.warning600 : colors.gray400}
        />
        <StatCard
          value={stalled.length}
          label={t('training_stalled')}
          icon={AlertCircle}
          color={stalled.length > 0 ? colors.danger600 : colors.gray400}
        />
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {['all', 'unassigned', 'stalled'].map((f) => (
          <Pressable
            key={f}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all'
                ? t('all')
                : f === 'unassigned'
                  ? t('training_unassigned')
                  : t('training_stalled')}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Trainee list */}
      <ScrollView contentContainerStyle={styles.list}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <CheckCircle size={32} color={colors.gray300} strokeWidth={2} />
            <Text style={styles.emptyText}>
              {filter === 'unassigned'
                ? t('training_no_unassigned')
                : filter === 'stalled'
                  ? t('training_no_stalled')
                  : t('training_no_trainees')}
            </Text>
          </View>
        ) : (
          filtered.map((tr) => {
            const modules = trainingModules(tr);
            const done = modules.filter((m) => m.done).length;
            const total = modules.length;
            const pct = Math.round((done / total) * 100);
            const hasTrainer = !!tr.training?.trainerEmail;

            return (
              <Pressable
                key={tr.email}
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => setSelectedTrainee(tr)}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardEmail} numberOfLines={1}>
                      {tr.email}
                    </Text>
                    {!hasTrainer && (
                      <View style={styles.unassignedBadge}>
                        <Text style={styles.unassignedBadgeText}>{t('training_no_trainer')}</Text>
                      </View>
                    )}
                  </View>

                  {hasTrainer && (
                    <View style={styles.trainerRow}>
                      <UserCheck size={11} color={colors.gray500} strokeWidth={2.2} />
                      <Text style={styles.trainerText} numberOfLines={1}>
                        {tr.training.trainerName || tr.training.trainerEmail}
                      </Text>
                    </View>
                  )}

                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.progressText}>
                    {t('training_modules_progress', { done, total })}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.gray400} strokeWidth={2.2} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* The same module checklist used by trainers, but with admin attribution */}
      <TraineeProgressSheet
        isOpen={!!selectedTrainee}
        onClose={() => setSelectedTrainee(null)}
        trainee={selectedTrainee}
        markedBy={{
          email: profile?.email || 'admin',
          name: profile?.full_name || 'Admin',
          role: MARKED_BY_ADMIN,
        }}
      />
    </ScreenContainer>
  );
}

function StatCard({ value, label, icon: Icon, color }) {
  return (
    <View style={styles.statCard}>
      <Icon size={16} color={color} strokeWidth={2.3} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    marginBottom: spacing.space4,
  },
  title: {
    fontSize: fontSizes.fs2xl,
    fontFamily: fontFamilies.interBold,
    fontWeight: fontWeights.fwBold,
    color: colors.gray900,
  },
  subtitle: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
    marginTop: 2,
  },

  statsRow: {
    flexDirection: 'row',
    gap: spacing.space3,
    marginBottom: spacing.space4,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radii.radiusLg,
    padding: spacing.space3,
    borderWidth: 1,
    borderColor: colors.gray200,
    gap: spacing.space1,
  },
  statValue: {
    fontSize: fontSizes.fs2xl,
    fontFamily: fontFamilies.interBold,
    fontWeight: fontWeights.fwBold,
  },
  statLabel: {
    fontSize: 10,
    fontFamily: fontFamilies.interMedium,
    color: colors.gray500,
    textAlign: 'center',
  },

  filterRow: {
    flexDirection: 'row',
    gap: spacing.space2,
    marginBottom: spacing.space4,
  },
  filterChip: {
    paddingVertical: spacing.space2,
    paddingHorizontal: spacing.space3,
    borderRadius: radii.radiusFull,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
  },
  filterChipActive: {
    backgroundColor: colors.primary600,
    borderColor: colors.primary600,
  },
  filterText: {
    fontSize: fontSizes.fsXs,
    fontFamily: fontFamilies.interMedium,
    color: colors.gray600,
  },
  filterTextActive: {
    color: colors.white,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
  },

  list: {
    gap: spacing.space3,
    paddingBottom: spacing.space5,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.space6,
    gap: spacing.space2,
  },
  emptyText: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
    textAlign: 'center',
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    backgroundColor: colors.white,
    borderRadius: radii.radiusXl,
    padding: spacing.space4,
    borderWidth: 1,
    borderColor: colors.gray200,
    ...shadows.shadowSm,
  },
  cardPressed: { opacity: 0.7 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    marginBottom: 4,
  },
  cardEmail: {
    flex: 1,
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    color: colors.gray900,
  },
  unassignedBadge: {
    backgroundColor: colors.warning50,
    borderRadius: radii.radiusFull,
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  unassignedBadgeText: {
    fontSize: 9,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    color: colors.warning700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  trainerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  trainerText: {
    flex: 1,
    fontSize: 10.5,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
  },
  progressBar: {
    height: 5,
    borderRadius: radii.radiusFull,
    backgroundColor: colors.gray200,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.radiusFull,
    backgroundColor: colors.primary600,
  },
  progressText: {
    fontSize: 10.5,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
  },
});
