import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Navigation2, Wallet, Scale, Star, Check, Lightbulb, Trophy } from 'lucide-react-native';
import { useLanguage } from '@context/LanguageContext';
import {
  getAllocationDemo,
  ALLOCATION_RADIUS_KM,
  ALLOCATION_WEIGHTS,
  formatRupees,
} from '@data/allocationDemo';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * The worker-facing side of the fairness allocation — "why did this job come to me and not to them?"
 *
 * SAME SOURCE AS THE CUSTOMER'S SCAN. Every figure here comes from getAllocationDemo(), which is the
 * roster the customer's GPS scanner animated. That is the point of the feature: the worker is shown
 * the actual comparison the customer watched being made, not a separate reassuring summary. Passing
 * `youName` relabels the selected candidate as the signed-in worker, so the panel reads in first
 * person while staying the same data.
 *
 * WHY THREE VIEWS RATHER THAN ONE TABLE: the feed's filter pills are already labelled Fairness queue
 * / Distance / Earnings, and each one is a genuine question a worker asks separately ("was someone
 * closer?", "was someone owed the work more?", "how did it add up?"). One dense table would answer
 * all three badly.
 *
 * PRESENTATION ONLY. Nothing here sorts, filters or allocates anything — it renders a decision that
 * was already made.
 */

const VIEW_META = {
  overall: { Icon: Scale, tint: colors.success50, border: '#a7f3d0', fg: colors.success700 },
  distance: { Icon: Navigation2, tint: colors.info50, border: colors.info100, fg: colors.info700 },
  earnings: { Icon: Wallet, tint: colors.accent50, border: colors.accent100, fg: colors.accent700 },
};

export default function AllocationComparisonPanel({ view = 'overall', youName, style }) {
  const { t } = useLanguage();
  const { byScore, byDistance, byEarnings, winner, gaps, averages, count } = useMemo(
    () => getAllocationDemo({ youName }),
    [youName],
  );

  const meta = VIEW_META[view] || VIEW_META.overall;
  const { Icon } = meta;

  // Rows are pre-sorted by the axis being explained, so position in the list IS the ranking. The
  // earnings list is ascending because LESS earned is better here — see allocationDemo.js.
  const rows = view === 'distance' ? byDistance : view === 'earnings' ? byEarnings : byScore;

  // Bars are scaled against the largest value on the axis, so the widest bar is always the extreme
  // and the winner's bar length is meaningful rather than arbitrary.
  const metricOf = (c) => (view === 'distance' ? c.distanceKm : view === 'earnings' ? c.weekEarnings : c.score);
  const maxMetric = Math.max(...rows.map(metricOf));

  const valueOf = (c) =>
    view === 'distance'
      ? `${c.distanceKm} km`
      : view === 'earnings'
      ? `₹${formatRupees(c.weekEarnings)}`
      : `${c.score}`;

  const title =
    view === 'distance' ? t('alloc_distance_title') : view === 'earnings' ? t('alloc_earnings_title') : t('alloc_overall_title');
  const subtitle =
    view === 'distance'
      ? t('alloc_distance_sub', { count, radius: ALLOCATION_RADIUS_KM })
      : view === 'earnings'
      ? t('alloc_earnings_sub', { count })
      : t('alloc_overall_sub', { count });

  const verdict =
    view === 'distance'
      ? t('alloc_distance_verdict', { count, gap: gaps.distanceKm })
      : view === 'earnings'
      ? t('alloc_earnings_verdict', { count, amount: formatRupees(gaps.earnings) })
      : t('alloc_overall_verdict', { count, score: winner.score, gap: gaps.score });

  return (
    <View style={[styles.panel, { backgroundColor: meta.tint, borderColor: meta.border }, style]}>
      <View style={styles.head}>
        <Icon size={15} color={meta.fg} strokeWidth={2.3} />
        <Text style={[styles.title, { color: meta.fg }]}>{title}</Text>
      </View>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.rows}>
        {rows.map((c, i) => {
          const best = c.selected;
          const pct = maxMetric > 0 ? Math.max(6, Math.round((metricOf(c) / maxMetric) * 100)) : 6;
          return (
            <View key={c.id} style={[styles.row, best && styles.rowBest]}>
              <View style={styles.rowTop}>
                <View style={[styles.rank, best && styles.rankBest]}>
                  <Text style={[styles.rankText, best && styles.rankTextBest]}>{i + 1}</Text>
                </View>
                <Text style={[styles.name, best && styles.nameBest]} numberOfLines={1}>
                  {c.displayName}
                </Text>
                {c.isYou && (
                  <View style={styles.youPill}>
                    <Text style={styles.youPillText}>{t('alloc_you')}</Text>
                  </View>
                )}
                {best && !c.isYou && (
                  <View style={styles.youPill}>
                    <Text style={styles.youPillText}>{t('alloc_selected')}</Text>
                  </View>
                )}
                <Text style={[styles.value, best && styles.valueBest]}>{valueOf(c)}</Text>
              </View>

              <View style={styles.barTrack}>
                <View style={[styles.barFill, best && styles.barFillBest, { width: `${pct}%` }]} />
              </View>

              {/* The other two axes, so a row is never judged on one number in isolation. */}
              <View style={styles.subMetaRow}>
                {view !== 'distance' && (
                  <View style={styles.subMeta}>
                    <Navigation2 size={10} color={colors.gray500} strokeWidth={2.3} />
                    <Text style={styles.subMetaText}>{c.distanceKm} km</Text>
                  </View>
                )}
                {view !== 'earnings' && (
                  <View style={styles.subMeta}>
                    <Wallet size={10} color={colors.gray500} strokeWidth={2.3} />
                    <Text style={styles.subMetaText}>₹{formatRupees(c.weekEarnings)}</Text>
                  </View>
                )}
                <View style={styles.subMeta}>
                  <Star size={10} color={colors.accent500} fill={colors.accent500} strokeWidth={0} />
                  <Text style={styles.subMetaText}>{c.rating.toFixed(1)}</Text>
                </View>
                <View style={styles.subMeta}>
                  <Text style={styles.subMetaText}>{t('alloc_jobs_week', { count: c.weekJobs })}</Text>
                </View>
                {!best && <Text style={styles.notOffered}>{t('alloc_not_offered')}</Text>}
              </View>
            </View>
          );
        })}
      </View>

      {view === 'overall' && (
        <Text style={styles.weights}>
          {t('alloc_weights', {
            distance: Math.round(ALLOCATION_WEIGHTS.distance * 100),
            earnings: Math.round(ALLOCATION_WEIGHTS.earnings * 100),
            rating: Math.round(ALLOCATION_WEIGHTS.rating * 100),
          })}
        </Text>
      )}

      <View style={styles.verdictBox}>
        <Trophy size={13} color={colors.success700} strokeWidth={2.3} />
        <Text style={styles.verdictText}>{verdict}</Text>
      </View>

      {view === 'overall' && (
        <Text style={styles.avgNote}>
          {t('alloc_scan_average', {
            distance: averages.distanceKm,
            amount: formatRupees(averages.earnings),
            rating: averages.rating,
          })}
        </Text>
      )}
    </View>
  );
}

/**
 * The diagnosis shown when a worker is about to accept — the fairness system explaining itself at
 * the exact moment the worker is deciding.
 *
 * Deliberately reason-by-reason rather than a table: at this point the worker does not need to audit
 * the ranking, they need the short answer to "is this fairly mine?". The full tables live behind the
 * feed's filter pills for anyone who wants to check the working.
 */
export function AllocationDiagnosisCard({ youName, serviceName, fairnessPosition }) {
  const { t } = useLanguage();
  const { winner, gaps, averages, count, others } = useMemo(
    () => getAllocationDemo({ youName }),
    [youName],
  );

  return (
    <View style={styles.diagCard}>
      <View style={styles.diagHead}>
        <Lightbulb size={16} color={colors.accent600} strokeWidth={2.3} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.diagTitle}>{t('alloc_diagnosis_title')}</Text>
          <Text style={styles.diagSub}>{t('alloc_diagnosis_sub')}</Text>
        </View>
        <View style={styles.diagScore}>
          <Text style={styles.diagScoreText}>{winner.score}</Text>
        </View>
      </View>

      <DiagRow text={t('alloc_reason_scan', { count, radius: ALLOCATION_RADIUS_KM })} />
      <DiagRow text={t('alloc_reason_distance', { distance: `${winner.distanceKm} km`, gap: gaps.distanceKm })} />
      <DiagRow text={t('alloc_reason_earnings', { amount: formatRupees(winner.weekEarnings), avg: formatRupees(averages.earnings) })} />
      <DiagRow text={t('alloc_reason_rating', { rating: winner.rating.toFixed(1), avg: averages.otherRating })} />
      <DiagRow text={t('alloc_reason_skill', { service: serviceName })} />
      {fairnessPosition != null && <DiagRow text={t('alloc_reason_queue', { pos: fairnessPosition })} />}
      <DiagRow text={t('alloc_reason_exclusive', { count: others.length })} last />
    </View>
  );
}

function DiagRow({ text, last }) {
  return (
    <View style={[styles.diagRow, !last && styles.diagRowBorder]}>
      <View style={styles.diagCheck}>
        <Check size={11} color={colors.success700} strokeWidth={3} />
      </View>
      <Text style={styles.diagText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.space4,
    borderRadius: radii.radiusXl,
    borderWidth: 1,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  title: { fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  subtitle: {
    fontSize: 11, color: colors.gray600, marginTop: 3,
    fontFamily: fontFamilies.interRegular, lineHeight: 15,
  },

  rows: { marginTop: spacing.space3, gap: spacing.space2 },
  row: {
    padding: spacing.space3,
    borderRadius: radii.radiusMd,
    backgroundColor: colors.surfaceWhite,
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  rowBest: { borderColor: colors.success500, borderWidth: 1.5 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rank: {
    width: 18, height: 18, borderRadius: radii.radiusFull,
    backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center',
  },
  rankBest: { backgroundColor: colors.success600 },
  rankText: { fontSize: 9.5, color: colors.gray600, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  rankTextBest: { color: colors.white },
  name: {
    flexShrink: 1, fontSize: fontSizes.fsXs, color: colors.gray800,
    fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold,
  },
  nameBest: { color: colors.success800 },
  youPill: {
    paddingHorizontal: 5, paddingVertical: 1.5,
    borderRadius: radii.radiusFull, backgroundColor: colors.success100,
  },
  youPillText: { fontSize: 8.5, color: colors.success800, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  value: {
    marginLeft: 'auto', fontSize: fontSizes.fsXs, color: colors.gray700,
    fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold,
  },
  valueBest: { color: colors.success700 },

  barTrack: {
    height: 5, borderRadius: radii.radiusFull,
    backgroundColor: colors.gray100, marginTop: 7, overflow: 'hidden',
  },
  barFill: { height: 5, borderRadius: radii.radiusFull, backgroundColor: colors.gray300 },
  barFillBest: { backgroundColor: colors.success500 },

  subMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.space2, marginTop: 6 },
  subMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  subMetaText: { fontSize: 9.5, color: colors.gray500, fontFamily: fontFamilies.interMedium },
  notOffered: {
    marginLeft: 'auto', fontSize: 9, color: colors.gray400,
    fontFamily: fontFamilies.interMedium, fontStyle: 'italic',
  },

  weights: {
    marginTop: spacing.space3, fontSize: 10,
    color: colors.gray500, fontFamily: fontFamilies.interMedium,
  },

  verdictBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    marginTop: spacing.space3, padding: spacing.space3,
    borderRadius: radii.radiusMd,
    backgroundColor: colors.success50,
    borderWidth: 1, borderColor: colors.success100,
  },
  verdictText: {
    flex: 1, fontSize: 11, color: colors.success800,
    fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, lineHeight: 16,
  },

  avgNote: {
    marginTop: spacing.space2, fontSize: 10,
    color: colors.gray500, fontFamily: fontFamilies.interRegular, lineHeight: 14,
  },

  // ---- Accept-sheet diagnosis ----
  diagCard: {
    padding: spacing.space4,
    borderRadius: radii.radiusXl,
    backgroundColor: colors.accent50,
    borderWidth: 1,
    borderColor: colors.accent100,
  },
  diagHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, marginBottom: spacing.space1 },
  diagTitle: { fontSize: fontSizes.fsBase, color: colors.gray900, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  diagSub: { fontSize: 10.5, color: colors.gray600, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  diagScore: {
    paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radii.radiusFull, backgroundColor: colors.success600,
  },
  diagScoreText: { fontSize: fontSizes.fsXs, color: colors.white, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  diagRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.space2, paddingVertical: 8 },
  diagRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.accent100 },
  diagCheck: {
    width: 18, height: 18, borderRadius: radii.radiusFull, marginTop: 1,
    backgroundColor: colors.success100, alignItems: 'center', justifyContent: 'center',
  },
  diagText: { flex: 1, fontSize: fontSizes.fsXs, color: colors.gray700, fontFamily: fontFamilies.interMedium, lineHeight: 17 },
});
