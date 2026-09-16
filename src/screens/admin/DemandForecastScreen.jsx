import { useState, useMemo, useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line as SvgLine, Text as SvgText, G } from 'react-native-svg';
import {
  TrendingUp, AlertTriangle, Calendar, Users, BarChart3, MapPin, Brain, RefreshCw, ChevronRight,
} from 'lucide-react-native';
import { generateZoneForecast, getStaffingRecommendations } from '@utils/forecastEngine';
import { forecastAll, forecastCategory, historyByCategory, modelInfo } from '@utils/mlForecast';
import { getDemandHistory, weatherFor, dateKey, countRealBookingsInHistory } from '@data/demandHistory';
import { mockWorkers } from '@data/mockWorkers';
import { useBookings } from '@data/mockBookings';
import { getAllRegisteredSkillCounts, useWorkerRegistration } from '@data/workerRegistration';
import { useLanguage } from '@context/LanguageContext';
import { ScreenContainer, PortalHeader } from '@components/app';
import StatsCard from '@components/ui/StatsCard';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * DemandForecastScreen — ported from web pages/admin/DemandForecast.jsx (admin accent = red).
 *
 * NOW BACKED BY A TRAINED MODEL (see ml/README.md).
 *
 * Previously this screen ran hand-written multipliers over a history that was re-randomised at every
 * app launch, and "Regenerate" only toggled a spinner for 1.5s — the numbers that came back were
 * byte-identical, which is what made it read as fake. Three things changed:
 *
 *   1. The history comes from @data/demandHistory: a deterministic per-date baseline with REAL
 *      bookings overlaid, so it is reproducible AND responds to activity elsewhere in the app.
 *   2. Predictions come from @utils/mlForecast — gradient-boosted trees trained offline by
 *      ml/train.py and scored on-device from exported parameters. No native module, no network.
 *   3. Regenerate re-draws the 7-day weather assumption and re-runs inference, so the output
 *      genuinely changes, and the run is stamped with the model's real holdout metrics.
 *
 * Still from the original engine: generateZoneForecast and getStaffingRecommendations. The zone
 * heatmap stays synthetic because bookings carry no zone (see ml/README.md).
 *
 * The one necessary re-implementation: the web drew the line chart on an HTML <canvas>. RN has no
 * canvas, so the chart is redrawn with react-native-svg — same visual: grid + y-labels, a
 * translucent confidence band (Path), the predicted-demand line (Path), per-day points (Circle,
 * amber when a festival lands that day), value labels, and x-axis day/date labels. The desktop
 * <table> daily breakdown becomes a mobile card list; staffing + zone heatmap ported as-is.
 */

const CATEGORIES = [
  { id: 'plumbing', name: 'Plumbing', emoji: '🔧' },
  { id: 'electrical', name: 'Electrical', emoji: '⚡' },
  { id: 'cleaning', name: 'Cleaning', emoji: '🧹' },
  { id: 'painting', name: 'Painting', emoji: '🎨' },
  { id: 'carpentry', name: 'Carpentry', emoji: '🔨' },
  { id: 'ac-repair', name: 'AC Repair', emoji: '❄️' },
  { id: 'pest-control', name: 'Pest Control', emoji: '🐛' },
  { id: 'appliance-repair', name: 'Appliance', emoji: '⚙️' },
];

const CHART_H = 240;
const FORECAST_DAYS = 7;

/**
 * Stages shown while regenerating. Each names a step the pipeline genuinely performs — see
 * src/utils/mlForecast.js and src/data/demandHistory.js — so the progress text describes work
 * rather than filling time.
 */
const PROGRESS_STAGES = [
  'stage_loading_history',
  'stage_building_features',
  'stage_weather_draw',
  'stage_scoring_trees',
  'stage_confidence_bands',
];

// Urgency → refined status treatment (same three urgency values the engine produces).
const STAFF_TONES = {
  understaffed: { labelKey: 'understaffed', bg: '#fee2e2', fg: '#dc2626', softBg: '#fef2f2', textStrong: '#b91c1c' },
  tight: { labelKey: 'tight', bg: '#fef3c7', fg: '#d97706', softBg: '#fffbeb', textStrong: '#b45309' },
  covered: { labelKey: 'covered', bg: '#d1fae5', fg: '#059669', softBg: '#ecfdf5', textStrong: '#065f46' },
};

// Soft pastel icon-container tints per trade (purely visual).
const CAT_ICON_TINTS = {
  plumbing: '#eef2ff',
  electrical: '#fffbeb',
  cleaning: '#ecfdf5',
  painting: '#fef2f2',
  carpentry: '#fff7ed',
  'ac-repair': '#ecfeff',
  'pest-control': '#f5f3ff',
  'appliance-repair': '#eff6ff',
  default: '#f3f4f6',
};

export default function DemandForecastScreen() {
  const { t } = useLanguage();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isGenerating, setIsGenerating] = useState(false);

  // Re-derive when a booking is placed/completed or a worker registers, so the forecast reflects
  // real activity from the other portals.
  const bookingsVersion = useBookings();
  useWorkerRegistration(null);

  /**
   * `runId` is what makes Regenerate mean something: bumping it re-draws the weather assumption and
   * re-runs inference. `runStamp` records when, and `previousTotal` lets the UI show the delta
   * against the last run rather than claiming a change the user cannot see.
   */
  const [runId, setRunId] = useState(0);
  const [runStamp, setRunStamp] = useState(() => new Date());
  const [previousTotal, setPreviousTotal] = useState(null);
  const [progressStage, setProgressStage] = useState(0);

  // The 120-day series: deterministic synthetic baseline + real bookings overlaid.
  // bookingsVersion is a deliberate cache-buster — mockBookings is a mutable singleton whose
  // identity never changes, so the linter sees the dep as unnecessary while omitting it would
  // freeze the history at whatever was loaded on first mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const history = useMemo(() => getDemandHistory(), [bookingsVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const realBookingCount = useMemo(() => countRealBookingsInHistory(), [bookingsVersion]);
  const seriesByCategory = useMemo(() => historyByCategory(history), [history]);

  /**
   * The 7-day weather assumption for this run.
   *
   * Run 0 uses the deterministic weather for each date, so a freshly opened screen always shows the
   * same forecast. Every regenerate after that re-draws it — which is what a real refresh does when
   * a new weather feed arrives, and is the honest way to make the output change given the model is
   * deterministic for fixed inputs.
   */
  const weatherByDate = useMemo(() => {
    const map = {};
    const today = new Date();
    for (let i = 1; i <= FORECAST_DAYS; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      d.setDate(d.getDate() + i);
      const key = dateKey(d);
      map[key] = runId === 0
        ? weatherFor(key)
        : weatherFor(`${key}#run${runId}`); // re-draw, still deterministic per run
    }
    return map;
  }, [runId]);

  // Model inference. Both the "All" view and the per-category views come from the same model.
  const modelRun = useMemo(
    () => forecastAll(seriesByCategory, FORECAST_DAYS, weatherByDate),
    [seriesByCategory, weatherByDate],
  );
  const aggregateForecast = modelRun.totals;
  const categoryForecast = useMemo(
    () => (selectedCategory === 'all'
      ? null
      : forecastCategory(seriesByCategory[selectedCategory] || [], selectedCategory, FORECAST_DAYS, weatherByDate)),
    [selectedCategory, seriesByCategory, weatherByDate],
  );

  const zoneForecast = useMemo(() => generateZoneForecast(history), [history]);

  // Zone rows for the prioritized list — all values below are DERIVED from the same real
  // `zoneForecast` demand counts (no new data source, no fabricated figures):
  //   • zoneTotal  = sum of demand counts (the "Total: N Requests").
  //   • share      = demand / total, rounded (shown once per row, e.g. "South (29%)").
  //   • pct        = demand / maxDemand (bar width, so the top zone fills the track).
  //   • tone/label = a status treatment picked from the zone's share of the total.
  const zoneEntries = useMemo(
    () => Object.entries(zoneForecast).sort((a, b) => b[1] - a[1]),
    [zoneForecast]
  );
  const zoneTotal = useMemo(() => zoneEntries.reduce((sum, [, d]) => sum + d, 0), [zoneEntries]);
  const zoneRows = useMemo(() => {
    const maxDemand = Math.max(...zoneEntries.map(([, d]) => d), 1);
    const total = zoneTotal || 1;
    return zoneEntries.map(([zone, demand]) => {
      const shareRatio = demand / total;
      const level = zoneLevel(shareRatio);
      return {
        zone,
        demand,
        share: Math.round(shareRatio * 100),
        pct: Math.round((demand / maxDemand) * 100),
        tone: level.tone,
        labelKey: level.labelKey,
        critical: level.critical,
      };
    });
  }, [zoneEntries, zoneTotal]);

  /**
   * Worker supply per trade = seeded demo workers PLUS workers who registered through the app.
   *
   * The registered half was previously missing entirely: this counted mockWorkers only, so someone
   * who signed up, chose their trades and had their certificate approved contributed nothing, and
   * the staffing gap would keep reporting a shortage right after onboarding. getAllRegisteredSkillCounts
   * already excludes banned accounts and anyone still pending verification or mid-training, since
   * those workers genuinely cannot take jobs yet.
   */
  const availableByCategory = useMemo(() => {
    const counts = {};
    mockWorkers.forEach((w) => {
      if (w.available) {
        w.skills.forEach((skill) => {
          const cat = skill.toLowerCase().replace(' repair', '-repair').replace(' control', '-control');
          counts[cat] = (counts[cat] || 0) + 1;
        });
      }
    });
    Object.entries(getAllRegisteredSkillCounts()).forEach(([cat, n]) => {
      counts[cat] = (counts[cat] || 0) + n;
    });
    return counts;
    // Recomputed per run so a newly approved worker shows up without an app restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, bookingsVersion]);

  const staffingRecs = useMemo(
    () => getStaffingRecommendations(aggregateForecast, availableByCategory),
    [aggregateForecast, availableByCategory]
  );

  const activeForecast = selectedCategory === 'all' ? aggregateForecast : categoryForecast;
  const totalPredicted = activeForecast?.reduce((sum, d) => sum + d.predicted, 0) || 0;
  const avgPredicted = activeForecast?.length ? Math.round(totalPredicted / activeForecast.length) : 0;
  const peakDay = activeForecast?.reduce((max, d) => (d.predicted > max.predicted ? d : max), activeForecast[0]);
  const workersOnline = mockWorkers.filter((w) => w.available).length;

  // Frontend-only visualization bounds derived from the existing predicted values
  // (used to scale the per-day demand bars and pick a relative status label). No new data.
  const dayMax = activeForecast?.length ? Math.max(...activeForecast.map((d) => d.predicted)) : 0;
  const dayMin = activeForecast?.length ? Math.min(...activeForecast.map((d) => d.predicted)) : 0;

  /**
   * Re-runs the model.
   *
   * The staged messages name the steps the pipeline actually performs — loading the history,
   * building lag/rolling features, drawing the weather assumption, walking the boosted trees,
   * computing confidence bands — rather than padding time with a generic spinner. The delay exists
   * so those stages are legible; the work itself is a few milliseconds.
   */
  const handleRegenerate = () => {
    setPreviousTotal(totalPredicted);
    setIsGenerating(true);
    setProgressStage(0);

    const stageTimers = PROGRESS_STAGES.map((_, i) =>
      setTimeout(() => setProgressStage(i), i * 260),
    );

    const done = setTimeout(() => {
      setRunId((n) => n + 1);
      setRunStamp(new Date());
      setIsGenerating(false);
      setProgressStage(0);
    }, PROGRESS_STAGES.length * 260 + 200);

    // Cleared if the screen unmounts mid-run, so no setState lands on an unmounted component.
    pendingTimers.current = [...stageTimers, done];
  };

  const pendingTimers = useRef([]);
  useEffect(() => () => pendingTimers.current.forEach(clearTimeout), []);

  // Bottom padding that clears the floating (absolutely-positioned) admin tab bar so the final
  // card is fully scrollable into view. Mirrors AdminTabs' own geometry: safe-area inset +
  // its space3 bottom offset + 64 bar height, plus a comfortable gap. Scoped to this screen;
  // presentation-only, no logic/route/data changes.
  const scrollPadBottom = insets.bottom + spacing.space3 + 64 + spacing.space6;

  return (
    <ScreenContainer contentStyle={{ paddingBottom: scrollPadBottom }}>
      {/* Premium in-content header (PortalHeader kept for its logout action + accent bell slot) */}
      <PortalHeader
        title={t('demand_forecast_ai')}
        subtitle={t('forecast_subtitle')}
        accent={colors.primary600}
      />

      {/* Regenerate — premium full-width indigo button (same handler, same 1.5s behaviour) */}
      <Pressable
        style={({ pressed }) => [styles.regenBtn, pressed && styles.regenBtnPressed, isGenerating && styles.regenBtnBusy]}
        onPress={handleRegenerate}
        disabled={isGenerating}
        accessibilityRole="button"
        accessibilityLabel={t('regenerate_forecast')}
      >
        {isGenerating ? <ActivityIndicator size="small" color={colors.white} /> : <RefreshCw size={17} color={colors.white} strokeWidth={2.4} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.regenText}>
            {isGenerating ? t(PROGRESS_STAGES[progressStage]) : t('regenerate_forecast')}
          </Text>
          {!isGenerating && (
            <Text style={styles.regenSub}>
              {t('run_stamp', { time: runStamp.toLocaleTimeString(), run: runId + 1 })}
            </Text>
          )}
        </View>
      </Pressable>

      {/* ---- Model provenance. Every figure here is real: the metrics come from the holdout split
              in ml/train.py, and the booking count from the live history. ---- */}
      <View style={styles.modelCard}>
        <View style={styles.modelHeadRow}>
          <Brain size={14} color={colors.primary700} strokeWidth={2.4} />
          <Text style={styles.modelTitle}>{t('model_card_title', { version: modelInfo.version })}</Text>
          {modelInfo.dataSource === 'synthetic' && (
            <View style={styles.synthBadge}>
              <Text style={styles.synthBadgeText}>{t('synthetic_data')}</Text>
            </View>
          )}
        </View>
        <View style={styles.modelMetricRow}>
          <ModelMetric label={t('metric_mae')} value={modelInfo.metrics.gbm.mae.toFixed(2)} />
          <ModelMetric label={t('metric_mape')} value={`${modelInfo.metrics.gbm.mape.toFixed(1)}%`} />
          <ModelMetric label={t('metric_r2')} value={modelInfo.metrics.gbm.r2.toFixed(3)} />
        </View>
        <Text style={styles.modelFoot}>
          {t('model_card_foot', {
            trees: modelInfo.treeCount,
            features: modelInfo.featureCount,
            rows: modelInfo.trainRows.toLocaleString(),
          })}
        </Text>
        <Text style={styles.modelFoot}>
          {t('model_card_baseline', {
            improvement: Math.round(
              ((modelInfo.metrics.baselineWma7.mae - modelInfo.metrics.gbm.mae)
                / modelInfo.metrics.baselineWma7.mae) * 100,
            ),
          })}
        </Text>
        <Text style={styles.modelFoot}>
          {realBookingCount > 0
            ? t('model_card_real_bookings', { count: realBookingCount })
            : t('model_card_no_real_bookings')}
        </Text>
      </View>

      {/* ---- Change against the previous run, so a regenerate is verifiable rather than asserted ---- */}
      {previousTotal != null && previousTotal !== totalPredicted && !isGenerating && (
        <View style={[styles.deltaChip, totalPredicted > previousTotal ? styles.deltaUp : styles.deltaDown]}>
          <Text style={styles.deltaText}>
            {t('delta_vs_last_run', {
              sign: totalPredicted > previousTotal ? '+' : '',
              diff: totalPredicted - previousTotal,
              pct: Math.abs(Math.round(((totalPredicted - previousTotal) / previousTotal) * 100)),
            })}
          </Text>
        </View>
      )}

      {/* Category selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
        <CatChip label={t('all_categories')} emoji={null} icon={BarChart3} active={selectedCategory === 'all'} onPress={() => setSelectedCategory('all')} />
        {CATEGORIES.map((c) => (
          <CatChip key={c.id} label={t(`svc_${c.id}`)} emoji={c.emoji} active={selectedCategory === c.id} onPress={() => setSelectedCategory(c.id)} />
        ))}
      </ScrollView>

      {isGenerating ? (
        <View style={styles.generatingBox}>
          <Brain size={30} color={colors.primary600} />
          <Text style={styles.generatingTitle}>{t(PROGRESS_STAGES[progressStage])}</Text>
          <Text style={styles.generatingSub}>{t('running_model')}</Text>
          {/* Step dots, so the stages read as a sequence rather than a random cycle. */}
          <View style={styles.stageDots}>
            {PROGRESS_STAGES.map((s, i) => (
              <View key={s} style={[styles.stageDot, i <= progressStage && styles.stageDotOn]} />
            ))}
          </View>
        </View>
      ) : (
        <>
          {/* Stats — 2x2 */}
          <View style={styles.statsGrid}>
            <View style={styles.statCell}><StatsCard label={t('avg_daily_demand')} value={avgPredicted} icon={TrendingUp} color="primary" /></View>
            <View style={styles.statCell}><StatsCard label={t('total_7_days')} value={totalPredicted} icon={BarChart3} color="info" /></View>
            <View style={styles.statCell}><StatsCard label={t('peak_day')} value={peakDay ? `${peakDay.dayName} (${peakDay.predicted})` : '—'} icon={Calendar} color="warning" /></View>
            <View style={styles.statCell}><StatsCard label={t('workers_online')} value={workersOnline} icon={Users} color="success" /></View>
          </View>

          {/* Chart */}
          <View style={styles.chartCard}>
            <View style={styles.chartHeadRow}>
              <Text style={styles.chartTitle}>{t('predicted_demand_title')}</Text>
              {/* Passive descriptor of the real forecast window (FORECAST_DAYS), not a control. */}
              <View style={styles.rangePill}>
                <Text style={styles.rangePillText}>{FORECAST_DAYS} {t('days')}</Text>
              </View>
            </View>
            <ForecastChart data={activeForecast} width={width - spacing.space4 * 2 - spacing.space4 * 2} />
            <View style={styles.legendRow}>
              <Legend color={colors.primary600} label={t('predicted')} />
              <Legend band label={t('confidence')} />
              <Legend color={colors.accent500} label={t('festival')} />
            </View>
          </View>

          {/* ── AI insight card — premium soft-lavender demand alert.
                Composed entirely from the already-derived peakDay (no new data/logic). ── */}
          {peakDay && (
            <View style={styles.insightCard}>
              <View style={styles.insightIconLg}>
                <BarChart3 size={20} color={colors.primary600} strokeWidth={2.4} />
              </View>
              <View style={styles.insightBody}>
                <Text style={styles.insightHeadline}>
                  {t('demand_peak_on')} <Text style={styles.insightHeadlineHi}>{peakDay.dayName} ({peakDay.predicted})</Text>.
                </Text>
                <Text style={styles.insightSupport}>{t('allocate_more')}</Text>
              </View>
              {/* Minimal upward-trend bars — a purely decorative rising motif. */}
              <View style={styles.trendBars} accessible={false} importantForAccessibility="no-hide-descendants">
                {[10, 16, 13, 22, 28].map((h, idx) => (
                  <View key={idx} style={[styles.trendBar, { height: h, opacity: 0.35 + idx * 0.16 }]} />
                ))}
              </View>
            </View>
          )}

          {/* Daily breakdown — premium redesigned rows (same dates/values/ranges). */}
          <View style={styles.card}>
            <View style={styles.breakdownHead}>
              <View style={styles.breakdownHeadLeft}>
                <View style={styles.breakdownTitleRow}>
                  <Calendar size={16} color={colors.gray700} />
                  <Text style={styles.sectionTitle}>{t('daily_breakdown')}</Text>
                </View>
                <Text style={styles.breakdownSub}>{t('predicted_range')}</Text>
              </View>
              {/* Passive descriptor of the real forecast window (FORECAST_DAYS) — not a control. */}
              <View style={styles.weekPill}>
                <Text style={styles.weekPillText}>{t('this_week')}</Text>
              </View>
            </View>

            {activeForecast?.map((day, i) => {
              const isPeak = peakDay && day.date === peakDay.date;
              const level = demandLevel(day.predicted, dayMax, dayMin);
              const barPct = dayMax > 0 ? Math.max((day.predicted / dayMax) * 100, 6) : 6;
              return (
                <View key={day.date} style={[styles.dayRowV2, isPeak && styles.dayRowPeak, i > 0 && !isPeak && styles.dayRowGap]}>
                  {/* Left — date chip */}
                  <View style={[styles.dayChip, isPeak && styles.dayChipPeak]}>
                    <Text style={[styles.dayChipName, isPeak && styles.dayChipNamePeak]}>{day.dayName}</Text>
                    <Text style={[styles.dayChipDate, isPeak && styles.dayChipDatePeak]}>{day.date.slice(5)}</Text>
                  </View>

                  {/* Center — status + demand bar */}
                  <View style={styles.dayCenter}>
                    <View style={styles.dayStatusRow}>
                      <Text style={[styles.dayStatusText, { color: level.fg }]} numberOfLines={1}>
                        {isPeak ? t('highest_demand') : t(level.labelKey)}
                      </Text>
                      {isPeak ? <Text style={styles.dayCrown}> 👑</Text> : null}
                      {day.festival ? (
                        <View style={styles.dayFestTag}>
                          <Text style={styles.dayFestText} numberOfLines={1}>🎉 {day.festival}</Text>
                        </View>
                      ) : null}
                    </View>
                    <View style={styles.dayBarTrack}>
                      <View style={[styles.dayBarFill, { width: `${barPct}%`, backgroundColor: level.fg }]} />
                    </View>
                  </View>

                  {/* Right — predicted value + range */}
                  <View style={styles.dayRightV2}>
                    <Text style={[styles.dayPredictedV2, isPeak && styles.dayPredictedPeak]}>{day.predicted}</Text>
                    <Text style={styles.dayConfidenceV2}>{day.confidence[0]}–{day.confidence[1]}</Text>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Staffing recommendations — premium card redesign (data/logic unchanged) */}
          <View style={styles.staffSection}>
            <View style={styles.staffHeaderCard}>
              {/* Subtle decorative background waves — purely visual, non-interactive. */}
              <View style={styles.staffWaveWrap} pointerEvents="none" importantForAccessibility="no-hide-descendants">
                <Svg width={160} height={96} viewBox="0 0 160 96">
                  <Path d="M0 62 C40 40 70 84 110 58 C138 40 152 60 160 52" stroke="rgba(79,70,229,0.10)" strokeWidth={2} fill="none" />
                  <Path d="M0 78 C46 56 74 96 118 70 C144 54 154 72 160 66" stroke="rgba(99,102,241,0.08)" strokeWidth={2} fill="none" />
                </Svg>
              </View>
              <View style={styles.staffHeaderIcon}>
                <Brain size={18} color={colors.primary600} strokeWidth={2.3} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.staffHeaderTitle}>{t('ai_staffing')}</Text>
                <Text style={styles.staffHeaderSub}>{t('based_on_workload')}</Text>
              </View>
              <View style={styles.realtimePill}>
                <View style={styles.realtimeDot} />
                <Text style={styles.realtimeText}>{t('realtime')}</Text>
              </View>
            </View>

            {staffingRecs.map((rec) => {
              const cat = CATEGORIES.find((c) => c.id === rec.category);
              const ratio = Math.min((rec.available / Math.max(rec.peakDemand, 1)) * 100, 100);
              const tone = STAFF_TONES[rec.urgency] || STAFF_TONES.covered;
              const iconTint = CAT_ICON_TINTS[rec.category] || CAT_ICON_TINTS.default;
              return (
                <View key={rec.category} style={styles.staffCardV2}>
                  <View style={styles.staffTopRow}>
                    <View style={[styles.staffIconBox, { backgroundColor: iconTint }]}>
                      <Text style={styles.staffEmoji}>{cat?.emoji || '📋'}</Text>
                    </View>
                    <Text style={styles.staffNameV2} numberOfLines={1}>{t(`svc_${rec.category}`)}</Text>
                    <View style={[styles.staffPill, { backgroundColor: tone.bg }]}>
                      {rec.urgency === 'understaffed' ? (
                        <AlertTriangle size={11} color={tone.fg} strokeWidth={2.4} />
                      ) : null}
                      <Text style={[styles.staffPillText, { color: tone.fg }]}>{t(tone.labelKey)}</Text>
                    </View>
                  </View>

                  <View style={styles.staffBarRowV2}>
                    <View style={styles.staffBarTrackV2}>
                      <View style={[styles.staffBarFillV2, { width: `${ratio}%`, backgroundColor: tone.fg }]} />
                    </View>
                    <Text style={styles.staffRatioV2}>{rec.available}/{rec.peakDemand}</Text>
                  </View>

                  {/* Recommendation area — real rec.message + real rec.gap; non-functional chevron */}
                  <View style={[styles.recArea, { backgroundColor: tone.softBg }]}>
                    <View style={[styles.recIcon, { backgroundColor: tone.bg }]}>
                      <Users size={14} color={tone.fg} strokeWidth={2.3} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.recText, { color: tone.textStrong }]} numberOfLines={2}>{rec.message}</Text>
                      {rec.gap > 0 ? (
                        <Text style={styles.recSub}>{t('need_more_workers', { n: rec.gap })}</Text>
                      ) : null}
                    </View>
                    <ChevronRight size={16} color={tone.fg} />
                  </View>
                </View>
              );
            })}
          </View>

          {/* Zone heatmap */}
          <View style={styles.card}>
            {/* Header — title + pin, with a lighter "Total: N Requests" for context. */}
            <View style={styles.zoneHeadRow}>
              <View style={styles.sectionTitleRow}>
                <MapPin size={16} color={colors.gray700} />
                <Text style={styles.sectionTitle}>{t('zone_demand')}</Text>
              </View>
              <Text style={styles.zoneTotal}>{t('total_requests', { n: zoneTotal })}</Text>
            </View>

            {/* Prioritized, table-like rows (sorted descending). Share %, status label and the
                progress bar are all derived from the SAME real demand counts — nothing new is
                fetched or invented. */}
            <View style={styles.zoneList}>
              {zoneRows.map((z, i) => (
                <View key={z.zone} style={[styles.zoneRow, i > 0 && styles.zoneRowBorder]}>
                  {/* Column 1 — color-coded vertical status bar */}
                  <View style={[styles.zoneStatusBar, { backgroundColor: z.tone.fg }]} />

                  {/* Column 2 — zone (with share) over request count */}
                  <View style={styles.zoneNameCol}>
                    <Text style={styles.zoneNameV2} numberOfLines={1}>
                      {z.zone} <Text style={styles.zoneShare}>({z.share}%)</Text>
                    </Text>
                    <Text style={styles.zoneCount} numberOfLines={1}>{z.demand} {t('requests_lc')}</Text>
                  </View>

                  {/* Column 3 — demand label (priority badge) over a colored progress bar */}
                  <View style={styles.zoneMetricCol}>
                    <View style={[styles.zoneBadge, { backgroundColor: z.tone.bg }]}>
                      {z.critical ? <AlertTriangle size={10} color={z.tone.fg} strokeWidth={2.6} /> : null}
                      <Text style={[styles.zoneBadgeText, { color: z.tone.fg }]} numberOfLines={1}>{t(z.labelKey)}</Text>
                    </View>
                    <View style={styles.zoneBarTrackV2}>
                      <View style={[styles.zoneBarFillV2, { width: `${z.pct}%`, backgroundColor: z.tone.fg }]} />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </>
      )}
    </ScreenContainer>
  );
}

/**
 * ForecastChart — SVG re-implementation of the web canvas line chart. Draws a grid, the
 * confidence band (filled path between confidence[1] and confidence[0]), the predicted line,
 * per-point circles (amber if that day has a festival), value labels, and x-axis day/date labels.
 */
function ForecastChart({ data, width }) {
  if (!data?.length) return null;
  const W = Math.max(width, 260);
  const H = CHART_H;
  const pad = { top: 24, right: 16, bottom: 40, left: 34 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const highs = data.map((d) => d.confidence[1]);
  const lows = data.map((d) => d.confidence[0]);
  const maxVal = Math.max(...highs) * 1.1;
  const minVal = Math.max(0, Math.min(...lows) * 0.8);
  const range = maxVal - minVal || 1;

  const xStep = chartW / Math.max(data.length - 1, 1);
  const toX = (i) => pad.left + i * xStep;
  const toY = (v) => pad.top + chartH - ((v - minVal) / range) * chartH;

  // Confidence band path (top edge along highs, back along lows).
  let band = '';
  data.forEach((d, i) => { band += `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.confidence[1])} `; });
  for (let i = data.length - 1; i >= 0; i--) band += `L${toX(i)},${toY(data[i].confidence[0])} `;
  band += 'Z';

  // Predicted line path.
  let line = '';
  data.forEach((d, i) => { line += `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.predicted)} `; });

  // Translucent area under the predicted line (purely visual; same predicted values).
  let area = '';
  data.forEach((d, i) => { area += `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d.predicted)} `; });
  area += `L${toX(data.length - 1)},${pad.top + chartH} L${toX(0)},${pad.top + chartH} Z`;

  const gridLines = [0, 1, 2, 3, 4];

  return (
    <Svg width={W} height={H}>
      {/* Grid + y labels */}
      {gridLines.map((g) => {
        const y = pad.top + (chartH / 4) * g;
        const val = Math.round(maxVal - (range / 4) * g);
        return (
          <G key={g}>
            <SvgLine x1={pad.left} y1={y} x2={W - pad.right} y2={y} stroke={colors.gray200} strokeWidth={1} />
            <SvgText x={pad.left - 6} y={y + 4} fontSize={10} fill={colors.gray400} textAnchor="end">{val}</SvgText>
          </G>
        );
      })}

      {/* Confidence band */}
      <Path d={band} fill="rgba(79,70,229,0.08)" />

      {/* Translucent area fill under the predicted line */}
      <Path d={area} fill="rgba(99,102,241,0.12)" />

      {/* Predicted line */}
      <Path d={line} fill="none" stroke={colors.primary600} strokeWidth={2.75} strokeLinejoin="round" strokeLinecap="round" />

      {/* Points + labels */}
      {data.map((d, i) => (
        <G key={d.date}>
          <Circle cx={toX(i)} cy={toY(d.predicted)} r={4.5} fill={d.festival ? colors.accent500 : colors.primary600} stroke={colors.white} strokeWidth={2} />
          <SvgText x={toX(i)} y={toY(d.predicted) - 10} fontSize={10} fontWeight="bold" fill={colors.gray700} textAnchor="middle">{d.predicted}</SvgText>
          <SvgText x={toX(i)} y={H - pad.bottom + 16} fontSize={10} fill={colors.gray500} textAnchor="middle">{d.dayName}</SvgText>
          <SvgText x={toX(i)} y={H - pad.bottom + 28} fontSize={9} fill={colors.gray400} textAnchor="middle">{d.date.slice(5)}</SvgText>
        </G>
      ))}
    </Svg>
  );
}

function CatChip({ label, emoji, icon: Icon, active, onPress }) {
  return (
    <Pressable style={[styles.catChip, active && styles.catChipActive]} onPress={onPress}>
      {emoji ? <Text style={styles.catEmoji}>{emoji}</Text> : Icon ? <Icon size={14} color={active ? colors.primary700 : colors.gray600} /> : null}
      <Text style={[styles.catLabel, active && styles.catLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function Legend({ color, band, label }) {
  return (
    <View style={styles.legendItem}>
      {band ? <View style={styles.legendBand} /> : <View style={[styles.legendDot, { backgroundColor: color }]} />}
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/**
 * demandLevel — maps a day's predicted value to a relative status label + semantic color,
 * scaled between the min and max of the current forecast window. Purely presentational:
 * it reads the already-computed predicted values and derives no new demand data.
 */
function demandLevel(value, max, min) {
  const range = Math.max(max - min, 1);
  const t = (value - min) / range; // 0 (lowest) → 1 (highest)
  if (t >= 0.78) return { labelKey: 'high_demand', fg: colors.danger500 };
  if (t >= 0.4) return { labelKey: 'moderate_demand', fg: colors.primary600 };
  return { labelKey: 'lower_demand', fg: colors.success600 };
}

/**
 * zoneLevel — maps a zone's share of total demand to an intuitive priority treatment:
 *   red = critical/shortage, amber = moderate, yellow = normal, green = low.
 * Thresholds are on the share-of-total ratio, so the busiest zones escalate naturally.
 * Presentation only — reads the already-derived share and returns colors/labels.
 */
const ZONE_TONES = {
  critical: { fg: '#e11d48', bg: '#ffe4e6' }, // coral / red
  moderate: { fg: '#ea580c', bg: '#ffedd5' }, // amber / orange
  normal: { fg: '#ca8a04', bg: '#fef9c3' }, // yellow
  low: { fg: '#16a34a', bg: '#dcfce7' }, // green
};

function zoneLevel(shareRatio) {
  if (shareRatio >= 0.27) return { tone: ZONE_TONES.critical, labelKey: 'shortage_alert', critical: true };
  if (shareRatio >= 0.2) return { tone: ZONE_TONES.moderate, labelKey: 'moderate_demand_zone', critical: false };
  if (shareRatio >= 0.15) return { tone: ZONE_TONES.normal, labelKey: 'normal_demand', critical: false };
  return { tone: ZONE_TONES.low, labelKey: 'low_demand', critical: false };
}

/** One holdout metric in the model card. */
function ModelMetric({ label, value }) {
  return (
    <View style={styles.modelMetric}>
      <Text style={styles.modelMetricValue}>{value}</Text>
      <Text style={styles.modelMetricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // ---- Model provenance card ----
  modelCard: {
    backgroundColor: colors.primary50, borderRadius: radii.radiusLg, padding: spacing.space3,
    borderWidth: 1, borderColor: colors.primary100, gap: spacing.space2, marginBottom: spacing.space3,
  },
  modelHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  modelTitle: {
    flex: 1, fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold, color: colors.primary800,
  },
  synthBadge: {
    paddingVertical: 2, paddingHorizontal: spacing.space2, borderRadius: radii.radiusFull,
    backgroundColor: colors.warning100, borderWidth: 1, borderColor: colors.warning200,
  },
  synthBadgeText: {
    fontSize: 9, color: colors.warning800, fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  modelMetricRow: { flexDirection: 'row', gap: spacing.space2 },
  modelMetric: {
    flex: 1, alignItems: 'center', backgroundColor: colors.surfaceWhite,
    borderRadius: radii.radiusMd, paddingVertical: spacing.space2,
    borderWidth: 1, borderColor: colors.primary100,
  },
  modelMetricValue: {
    fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold, color: colors.gray900,
  },
  modelMetricLabel: {
    fontSize: 9, color: colors.gray500, fontFamily: fontFamilies.interMedium,
    textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1,
  },
  modelFoot: {
    fontSize: 10, color: colors.primary700, fontFamily: fontFamilies.interRegular, lineHeight: 14,
  },

  // ---- Run delta ----
  deltaChip: {
    alignSelf: 'flex-start', paddingVertical: spacing.space1, paddingHorizontal: spacing.space3,
    borderRadius: radii.radiusFull, borderWidth: 1, marginBottom: spacing.space3,
  },
  deltaUp: { backgroundColor: colors.success50, borderColor: colors.success100 },
  deltaDown: { backgroundColor: colors.warning50, borderColor: colors.warning200 },
  deltaText: {
    fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold, color: colors.gray800,
  },

  // ---- Regenerate progress dots ----
  stageDots: { flexDirection: 'row', gap: 6, marginTop: spacing.space3 },
  stageDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gray200 },
  stageDotOn: { backgroundColor: colors.primary600 },

  regenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.space3,
    paddingVertical: spacing.space4, paddingHorizontal: spacing.space4, borderRadius: radii.radiusLg,
    backgroundColor: colors.primary600,
    marginBottom: spacing.space4,
    ...shadows.shadowLg, shadowColor: colors.primary600,
  },
  regenBtnPressed: { backgroundColor: colors.primary700, transform: [{ scale: 0.99 }] },
  regenBtnBusy: { opacity: 0.85 },
  regenText: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },
  regenSub: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interRegular, color: 'rgba(255,255,255,0.82)', marginTop: 1 },

  catRow: { gap: spacing.space2, paddingBottom: spacing.space4 },
  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 15, borderRadius: radii.radiusFull,
    backgroundColor: colors.surfaceWhite, borderWidth: 1, borderColor: colors.gray200,
    ...shadows.shadowSm,
  },
  catChipActive: { backgroundColor: colors.primary600, borderColor: colors.primary600 },
  catEmoji: { fontSize: 14 },
  catLabel: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.gray600 },
  catLabelActive: { color: colors.white, fontFamily: fontFamilies.interSemiBold },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space3, marginBottom: spacing.space4 },
  statCell: { width: '47%', flexGrow: 1 },

  card: {
    backgroundColor: colors.white, borderRadius: radii.radiusLg, padding: spacing.space4,
    borderWidth: 1, borderColor: colors.gray100, marginBottom: spacing.space4, ...shadows.shadowSm,
  },
  chartCard: {
    backgroundColor: colors.white, borderRadius: radii.radiusXl, padding: spacing.space4,
    borderWidth: 1, borderColor: colors.gray100, marginBottom: spacing.space4, ...shadows.shadowMd,
  },
  chartHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.space2 },
  chartTitle: { flex: 1, fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  rangePill: { backgroundColor: colors.primary50, borderRadius: radii.radiusFull, paddingVertical: 4, paddingHorizontal: 10 },
  rangePillText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, color: colors.primary600 },
  /* AI insight card — premium soft-lavender demand alert */
  insightCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    backgroundColor: colors.primary50, borderRadius: radii.radiusXl,
    borderWidth: 1, borderColor: colors.primary100,
    padding: spacing.space4, marginBottom: spacing.space4,
    overflow: 'hidden',
  },
  insightIconLg: {
    width: 44, height: 44, borderRadius: radii.radiusLg, backgroundColor: colors.surfaceWhite,
    borderWidth: 1, borderColor: colors.primary100,
    alignItems: 'center', justifyContent: 'center',
    ...shadows.shadowSm, shadowColor: colors.primary600,
  },
  insightBody: { flex: 1, minWidth: 0 },
  insightHeadline: { fontSize: fontSizes.fsSm, color: colors.primary800, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, lineHeight: 19 },
  insightHeadlineHi: { fontFamily: fontFamilies.interExtraBold, fontWeight: fontWeights.fwExtrabold, color: colors.primary900 },
  insightSupport: { fontSize: fontSizes.fsXs, color: colors.primary700, fontFamily: fontFamilies.interRegular, marginTop: 3 },
  trendBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 30 },
  trendBar: { width: 5, borderRadius: 2, backgroundColor: colors.primary500 },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.space4, marginTop: spacing.space2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendBand: { width: 14, height: 10, borderRadius: 2, backgroundColor: 'rgba(79,70,229,0.18)' },
  legendText: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, marginBottom: spacing.space3 },
  sectionTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },

  /* Daily Breakdown — header */
  breakdownHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.space3 },
  breakdownHeadLeft: { flex: 1, minWidth: 0 },
  breakdownTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  breakdownSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2 },
  weekPill: { backgroundColor: colors.primary50, borderRadius: radii.radiusFull, borderWidth: 1, borderColor: colors.primary100, paddingVertical: 5, paddingHorizontal: 12, marginLeft: spacing.space2 },
  weekPillText: { fontSize: fontSizes.fsXs, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, color: colors.primary600 },

  /* Daily Breakdown — rows */
  dayRowV2: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space2, paddingHorizontal: spacing.space2, borderRadius: radii.radiusLg },
  dayRowGap: { marginTop: 2 },
  dayRowPeak: { backgroundColor: colors.primary50, borderWidth: 1, borderColor: colors.primary150, marginTop: 2 },
  dayChip: {
    width: 52, paddingVertical: 6, borderRadius: radii.radiusMd, backgroundColor: colors.gray50,
    borderWidth: 1, borderColor: colors.gray100, alignItems: 'center',
  },
  dayChipPeak: { backgroundColor: colors.surfaceWhite, borderColor: colors.primary200 },
  dayChipName: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  dayChipNamePeak: { color: colors.primary700 },
  dayChipDate: { fontSize: 10, color: colors.gray400, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  dayChipDatePeak: { color: colors.primary500 },
  dayCenter: { flex: 1, minWidth: 0, gap: 6 },
  dayStatusRow: { flexDirection: 'row', alignItems: 'center' },
  dayStatusText: { fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  dayCrown: { fontSize: fontSizes.fsSm },
  dayFestTag: { marginLeft: 6, backgroundColor: colors.accent50, borderRadius: radii.radiusFull, paddingVertical: 2, paddingHorizontal: 8, maxWidth: 120 },
  dayFestText: { fontSize: 10, color: colors.accent700, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  dayBarTrack: { height: 7, borderRadius: 4, backgroundColor: colors.gray100, overflow: 'hidden' },
  dayBarFill: { height: 7, borderRadius: 4 },
  dayRightV2: { alignItems: 'flex-end', minWidth: 56 },
  dayPredictedV2: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900 },
  dayPredictedPeak: { color: colors.primary600 },
  dayConfidenceV2: { fontSize: fontSizes.fsXs, color: colors.gray400, fontFamily: fontFamilies.interRegular, marginTop: 1 },

  /* Staffing recommendations v2 */
  staffSection: { marginBottom: spacing.space4 },
  staffHeaderCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    backgroundColor: colors.white, borderRadius: radii.radiusXl, padding: spacing.space4,
    borderWidth: 1, borderColor: colors.gray100, marginBottom: spacing.space3, ...shadows.shadowSm,
    position: 'relative', overflow: 'hidden',
  },
  staffWaveWrap: { position: 'absolute', right: 0, top: 0, bottom: 0, justifyContent: 'center' },
  staffHeaderIcon: {
    width: 40, height: 40, borderRadius: radii.radiusMd, backgroundColor: colors.primary50,
    borderWidth: 1, borderColor: colors.primary100, alignItems: 'center', justifyContent: 'center',
  },
  staffHeaderTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  staffHeaderSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  realtimePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.primary50, borderRadius: radii.radiusFull, paddingVertical: 5, paddingHorizontal: 10,
  },
  realtimeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary600 },
  realtimeText: { fontSize: 10, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, color: colors.primary600 },

  staffCardV2: {
    backgroundColor: colors.white, borderRadius: radii.radiusXl, padding: spacing.space4,
    borderWidth: 1, borderColor: colors.gray100, marginBottom: spacing.space3, ...shadows.shadowSm,
  },
  staffTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  staffIconBox: { width: 46, height: 46, borderRadius: radii.radiusMd, alignItems: 'center', justifyContent: 'center' },
  staffEmoji: { fontSize: 20 },
  staffNameV2: { flex: 1, fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  staffPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radii.radiusFull, paddingVertical: 4, paddingHorizontal: 9 },
  staffPillText: { fontSize: 11, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  staffBarRowV2: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, marginTop: spacing.space3 },
  staffBarTrackV2: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.gray100, overflow: 'hidden' },
  staffBarFillV2: { height: 8, borderRadius: 4 },
  staffRatioV2: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray800, minWidth: 40, textAlign: 'right' },
  recArea: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, borderRadius: radii.radiusMd, padding: spacing.space3, marginTop: spacing.space3 },
  recIcon: { width: 28, height: 28, borderRadius: radii.radiusFull, alignItems: 'center', justifyContent: 'center' },
  recText: { fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold, lineHeight: 17 },
  recSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },

  /* Zone-wise Demand — prioritized table-like list */
  zoneHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.space2, gap: spacing.space2 },
  zoneTotal: { fontSize: fontSizes.fsXs, color: colors.gray400, fontFamily: fontFamilies.interMedium, fontWeight: fontWeights.fwMedium },
  zoneList: { marginTop: spacing.space1 },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space3 },
  zoneRowBorder: { borderTopWidth: 1, borderTopColor: colors.gray100 },
  // Column 1 — color-coded vertical status bar.
  zoneStatusBar: { width: 4, alignSelf: 'stretch', minHeight: 38, borderRadius: radii.radiusFull },
  // Column 2 — zone name (with share) over request count.
  zoneNameCol: { width: 108, minWidth: 0 },
  zoneNameV2: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  zoneShare: { fontFamily: fontFamilies.interRegular, fontWeight: fontWeights.fwNormal, color: colors.gray400 },
  zoneCount: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 2 },
  // Column 3 — badge over colored progress bar.
  zoneMetricCol: { flex: 1, minWidth: 0, gap: 6 },
  zoneBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radii.radiusFull, paddingVertical: 3, paddingHorizontal: 8 },
  zoneBadgeText: { fontSize: 10, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  zoneBarTrackV2: { height: 6, borderRadius: 3, backgroundColor: colors.gray100, overflow: 'hidden' },
  zoneBarFillV2: { height: 6, borderRadius: 3 },

  generatingBox: { alignItems: 'center', gap: spacing.space2, paddingVertical: spacing.space8 },
  generatingTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900, marginTop: spacing.space2 },
  generatingSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, textAlign: 'center', paddingHorizontal: spacing.space6 },
});
