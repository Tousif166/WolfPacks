import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal as RNModalNative,
  View,
  Text,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Radar, Bike, MapPin, Star, Navigation2, Check, Scale, Trophy } from 'lucide-react-native';
import { useLanguage } from '@context/LanguageContext';
import {
  getAllocationDemo,
  ALLOCATION_RADIUS_KM,
  formatRupees,
} from '@data/allocationDemo';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * GpsAllocationScanner — the live "who should take this job?" sequence the customer watches between
 * pressing Confirm Booking and seeing their confirmation.
 *
 * WHAT IT IS: a presentation of the fairness allocation, driven entirely by the fixed roster in
 * src/data/allocationDemo.js. It renders no data of its own and decides nothing — the winner is
 * `getAllocationDemo().winner`, the same object the worker's diagnosis panel reads, so the two views
 * cannot drift apart.
 *
 * WHY IT BLOCKS THE CONFIRMATION: allocation is the one moment in this flow that is worth showing.
 * A booking that silently appears in a queue teaches the customer nothing about how the cooperative
 * distributes work; watching four professionals get compared, and the nearest/least-paid one win,
 * teaches it in ten seconds without a word of explanation.
 *
 * TIMELINE (fixed, deliberately unhurried so the sequence can be read):
 *   0.0s  scanning   — radar sweeps, the four professionals pop in one at a time, well apart
 *   5.0s  deciding   — "Deciding the best possible worker for you"; rivals dim, the winner is picked
 *   8.0s  selected   — the winner's card is revealed, with where they will set off from
 *  10.0s  onDone()   — the caller creates the booking and shows the confirmation
 *
 * The phase timers live in ONE effect with one cleanup, so dismissing mid-sequence cannot leave a
 * stray timer that fires onDone against an unmounted screen.
 *
 * ANIMATION IS TRANSFORM/OPACITY ONLY, so every driver runs natively. Nothing here animates layout.
 */

const SCAN_MS = 5000;
const DECIDE_MS = 3000;
const REVEAL_MS = 2000;

// When each professional pops onto the radar during the scan phase. Spread across the 5s so they
// arrive one at a time rather than appearing as a block.
const POP_DELAYS_MS = [700, 1700, 2700, 3700];

export default function GpsAllocationScanner({ visible, onDone, onCancel, placeLabel }) {
  // Remounting the body on each run resets every animated value and phase timer, so a second
  // booking plays the full sequence instead of flashing the previous run's final frame.
  return (
    <RNModalNative
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      {visible ? <ScannerBody onDone={onDone} placeLabel={placeLabel} /> : null}
    </RNModalNative>
  );
}

function ScannerBody({ onDone, placeLabel }) {
  const { t } = useLanguage();
  const { width } = useWindowDimensions();

  // No youName: the customer sees the professional's real name, not "You".
  const { candidates, winner, gaps } = useMemo(() => getAllocationDemo(), []);

  const [phase, setPhase] = useState('scanning'); // scanning -> deciding -> selected
  const [found, setFound] = useState(0);

  const radarSize = Math.min(width - spacing.space4 * 2 - spacing.space5 * 2, 300);

  // ---- Continuous radar motion -------------------------------------------------
  const sweep = useRef(new Animated.Value(0)).current;
  const pulseA = useRef(new Animated.Value(0)).current;
  const pulseB = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }),
    );
    const ring = (value, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, { toValue: 1, duration: 2000, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const a = ring(pulseA, 0);
    const b = ring(pulseB, 1000);
    spin.start();
    a.start();
    b.start();
    return () => {
      spin.stop();
      a.stop();
      b.stop();
    };
  }, [sweep, pulseA, pulseB]);

  // ---- Phase timeline ----------------------------------------------------------
  // onDone is held in a ref and the effect depends on NOTHING. The caller almost certainly passes an
  // inline arrow, so depending on it would restart the whole 10s sequence every time the parent
  // screen happened to re-render — and this parent subscribes to a store, so it does. The ref keeps
  // the timeline running exactly once per mount while still calling the latest callback.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const timers = [
      ...POP_DELAYS_MS.map((delay, i) => setTimeout(() => setFound(i + 1), delay)),
      setTimeout(() => setPhase('deciding'), SCAN_MS),
      setTimeout(() => setPhase('selected'), SCAN_MS + DECIDE_MS),
      setTimeout(() => onDoneRef.current && onDoneRef.current(), SCAN_MS + DECIDE_MS + REVEAL_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const rotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ringStyle = (value) => ({
    opacity: value.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] }),
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }],
  });

  const deciding = phase === 'deciding';
  const revealed = phase === 'selected';

  const title = revealed ? t('scan_selected_title') : deciding ? t('scan_deciding') : t('scan_title');
  const subtitle = revealed
    ? t('scan_selected_sub', { name: winner.displayName })
    : deciding
    ? t('scan_deciding_sub')
    : t('scan_sub', { radius: ALLOCATION_RADIUS_KM, place: placeLabel || t('your_location_short') });

  return (
    <View style={styles.backdrop}>
      <View style={styles.card}>
        {/* ---- Header ---- */}
        <View style={styles.head}>
          <View style={[styles.headIcon, revealed && styles.headIconDone]}>
            {revealed ? (
              <Trophy size={18} color={colors.success500} strokeWidth={2.3} />
            ) : (
              <Radar size={18} color={colors.primary300} strokeWidth={2.3} />
            )}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>

        {/* ---- Radar ---- */}
        <View style={[styles.radar, { width: radarSize, height: radarSize, borderRadius: radarSize / 2 }]}>
          {/* Static range rings + crosshairs, so the pins read as distances rather than decoration. */}
          <View style={[styles.rangeRing, { width: radarSize * 0.66, height: radarSize * 0.66, borderRadius: radarSize * 0.33 }]} />
          <View style={[styles.rangeRing, { width: radarSize * 0.33, height: radarSize * 0.33, borderRadius: radarSize * 0.165 }]} />
          <View style={styles.crosshairH} />
          <View style={styles.crosshairV} />

          {/* Expanding pulses */}
          <Animated.View
            style={[styles.pulse, { width: radarSize, height: radarSize, borderRadius: radarSize / 2 }, ringStyle(pulseA)]}
            pointerEvents="none"
          />
          <Animated.View
            style={[styles.pulse, { width: radarSize, height: radarSize, borderRadius: radarSize / 2 }, ringStyle(pulseB)]}
            pointerEvents="none"
          />

          {/* Sweep arm */}
          <Animated.View
            style={[styles.sweepWrap, { width: radarSize, height: radarSize, transform: [{ rotate }] }]}
            pointerEvents="none"
          >
            <View style={[styles.sweepArm, { height: radarSize / 2 }]} />
          </Animated.View>

          {/* The customer, at the centre */}
          <View style={styles.centrePin}>
            <View style={styles.centreDot} />
          </View>

          {/* The professionals */}
          {candidates.map((c, i) => (
            <BikePin
              key={c.id}
              candidate={c}
              radarSize={radarSize}
              popped={found > i}
              dimmed={(deciding || revealed) && !c.selected}
              highlighted={(deciding || revealed) && c.selected}
              t={t}
            />
          ))}
        </View>

        {/* ---- Scan counter ---- */}
        <View style={styles.counterRow}>
          <Bike size={13} color={colors.primary300} strokeWidth={2.3} />
          <Text style={styles.counterText}>
            {t('scan_found', { count: found, radius: ALLOCATION_RADIUS_KM })}
          </Text>
        </View>

        {/* ---- Winner card (reveal phase) ---- */}
        {revealed ? (
          <View style={styles.winnerCard}>
            <View style={styles.winnerTop}>
              <View style={styles.winnerAvatar}>
                <Text style={styles.winnerAvatarText}>{winner.displayName[0]}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.winnerName} numberOfLines={1}>{winner.displayName}</Text>
                <Text style={styles.winnerCoop} numberOfLines={1}>{winner.cooperative}</Text>
              </View>
              <View style={styles.scorePill}>
                <Scale size={11} color={colors.success500} strokeWidth={2.5} />
                <Text style={styles.scorePillText}>{winner.score}</Text>
              </View>
            </View>

            <View style={styles.winnerMetaRow}>
              <View style={styles.winnerMeta}>
                <Navigation2 size={12} color={colors.success500} strokeWidth={2.4} />
                <Text style={styles.winnerMetaText}>
                  {t('km_away', { distance: `${winner.distanceKm} km` })}
                </Text>
              </View>
              <View style={styles.winnerMeta}>
                <Star size={12} color={colors.accent400} fill={colors.accent400} strokeWidth={0} />
                <Text style={styles.winnerMetaText}>{winner.rating.toFixed(1)}</Text>
              </View>
              <View style={styles.winnerMeta}>
                <Text style={styles.winnerMetaText}>₹{formatRupees(winner.weekEarnings)}</Text>
                <Text style={styles.winnerMetaMuted}>{t('scan_week_earnings')}</Text>
              </View>
            </View>

            <View style={styles.startRow}>
              <MapPin size={12} color={colors.primary300} strokeWidth={2.3} />
              <Text style={styles.startText} numberOfLines={2}>
                {t('scan_starts_from', { place: winner.startPlace })}
              </Text>
            </View>

            <Text style={styles.verdict}>
              {t('scan_verdict', { gap: gaps.distanceKm, amount: formatRupees(gaps.earnings) })}
            </Text>
          </View>
        ) : (
          /* ---- Progress steps (scan + decide phases) ---- */
          <View style={styles.steps}>
            <Step label={t('scan_step_locate')} state="done" />
            <Step label={t('scan_step_scan')} state={phase === 'scanning' ? 'active' : 'done'} />
            <Step label={t('scan_step_decide')} state={deciding ? 'active' : 'idle'} />
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * One professional on the radar.
 *
 * Own component (not inline JSX in the map) because each pin owns three animated values. Hooks
 * cannot live inside a .map callback, and hoisting four sets of values into the parent would trade a
 * clean local animation for a bookkeeping problem.
 *
 * `popped` drives arrival, `dimmed`/`highlighted` drive the decision moment: the rivals recede and
 * the chosen worker grows and gains a ring, which is the whole visual argument that a choice was
 * made between them.
 */
function BikePin({ candidate, radarSize, popped, dimmed, highlighted, t }) {
  const scale = useRef(new Animated.Value(0.2)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!popped) return;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 5, tension: 90, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [popped, scale, opacity]);

  useEffect(() => {
    if (!dimmed && !highlighted) return undefined;
    Animated.parallel([
      Animated.spring(scale, { toValue: highlighted ? 1.18 : 0.82, friction: 6, tension: 90, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: highlighted ? 1 : 0.28, duration: 320, useNativeDriver: true }),
    ]).start();

    if (!highlighted) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [dimmed, highlighted, scale, opacity, glow]);

  // Pin positions are fractions of the radar box, so the layout scales with the device.
  const left = candidate.pin.x * radarSize;
  const top = candidate.pin.y * radarSize;

  return (
    <Animated.View
      style={[
        styles.pinWrap,
        { left: left - 24, top: top - 24, opacity, transform: [{ scale }] },
      ]}
      pointerEvents="none"
    >
      {highlighted && (
        <Animated.View
          style={[
            styles.pinGlow,
            {
              opacity: glow.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] }),
              transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.7] }) }],
            },
          ]}
        />
      )}
      <View style={[styles.pinBubble, highlighted && styles.pinBubbleWin]}>
        <Bike size={17} color={highlighted ? colors.white : colors.primary200} strokeWidth={2.3} />
      </View>
      <View style={[styles.pinTag, highlighted && styles.pinTagWin]}>
        <Text style={[styles.pinTagText, highlighted && styles.pinTagTextWin]} numberOfLines={1}>
          {highlighted ? t('best_match') : `${candidate.distanceKm} km`}
        </Text>
      </View>
    </Animated.View>
  );
}

function Step({ label, state }) {
  const done = state === 'done';
  const active = state === 'active';
  return (
    <View style={styles.step}>
      <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
        {done ? <Check size={10} color={colors.white} strokeWidth={3.2} /> : null}
      </View>
      <Text style={[styles.stepText, (active || done) && styles.stepTextOn]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Darker than colors.bgDarkOverlay: the radar's thin indigo strokes disappear against a light
    // scrim, and the sequence should read as an instrument panel rather than a dialog.
    backgroundColor: 'rgba(9, 12, 24, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.space4,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    padding: spacing.space5,
    borderRadius: radii.radiusXl,
    backgroundColor: 'rgba(30, 27, 75, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.28)',
  },

  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, alignSelf: 'stretch' },
  headIcon: {
    width: 38, height: 38, borderRadius: radii.radiusFull,
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    borderWidth: 1, borderColor: 'rgba(129, 140, 248, 0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  headIconDone: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  title: {
    fontSize: fontSizes.fsBase, color: colors.white,
    fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold,
  },
  subtitle: {
    fontSize: 11.5, color: colors.primary200, marginTop: 2,
    fontFamily: fontFamilies.interRegular, lineHeight: 16,
  },

  radar: {
    marginTop: spacing.space5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(49, 46, 129, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.35)',
    overflow: 'hidden',
  },
  rangeRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.22)',
  },
  crosshairH: { position: 'absolute', height: 1, left: 0, right: 0, backgroundColor: 'rgba(129, 140, 248, 0.16)' },
  crosshairV: { position: 'absolute', width: 1, top: 0, bottom: 0, backgroundColor: 'rgba(129, 140, 248, 0.16)' },
  pulse: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: colors.success500,
  },
  // The arm is a half-width bar pinned to the centre, so rotating the wrapper sweeps it like a
  // radar trace. Rotating the bar itself would spin it about its own middle instead.
  sweepWrap: { position: 'absolute', alignItems: 'center' },
  sweepArm: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: 'rgba(16, 185, 129, 0.55)',
  },

  centrePin: {
    position: 'absolute',
    width: 22, height: 22, borderRadius: radii.radiusFull,
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    borderWidth: 1, borderColor: colors.success500,
    alignItems: 'center', justifyContent: 'center',
  },
  centreDot: { width: 8, height: 8, borderRadius: radii.radiusFull, backgroundColor: colors.success500 },

  pinWrap: { position: 'absolute', width: 48, alignItems: 'center' },
  pinGlow: {
    position: 'absolute',
    top: -6,
    width: 48, height: 48, borderRadius: radii.radiusFull,
    borderWidth: 2, borderColor: colors.success500,
  },
  pinBubble: {
    width: 32, height: 32, borderRadius: radii.radiusFull,
    backgroundColor: 'rgba(67, 56, 202, 0.85)',
    borderWidth: 1.5, borderColor: 'rgba(165, 180, 252, 0.7)',
    alignItems: 'center', justifyContent: 'center',
  },
  pinBubbleWin: { backgroundColor: colors.success600, borderColor: colors.success100 },
  pinTag: {
    marginTop: 3,
    paddingHorizontal: 5, paddingVertical: 1.5,
    borderRadius: radii.radiusFull,
    backgroundColor: 'rgba(17, 24, 39, 0.75)',
  },
  pinTagWin: { backgroundColor: colors.success600 },
  pinTagText: { fontSize: 8.5, color: colors.primary200, fontFamily: fontFamilies.interSemiBold },
  pinTagTextWin: { color: colors.white },

  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.space4 },
  counterText: { fontSize: 11, color: colors.primary200, fontFamily: fontFamilies.interMedium },

  steps: { alignSelf: 'stretch', marginTop: spacing.space4, gap: spacing.space2 },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  stepDot: {
    width: 16, height: 16, borderRadius: radii.radiusFull,
    borderWidth: 1.5, borderColor: 'rgba(129, 140, 248, 0.4)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { borderColor: colors.success500, backgroundColor: 'rgba(16, 185, 129, 0.25)' },
  stepDotDone: { borderColor: colors.success500, backgroundColor: colors.success600 },
  stepText: { flex: 1, fontSize: 11.5, color: 'rgba(199, 210, 254, 0.55)', fontFamily: fontFamilies.interMedium },
  stepTextOn: { color: colors.primary100 },

  winnerCard: {
    alignSelf: 'stretch',
    marginTop: spacing.space4,
    padding: spacing.space4,
    borderRadius: radii.radiusLg,
    backgroundColor: 'rgba(6, 95, 70, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  winnerTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  winnerAvatar: {
    width: 38, height: 38, borderRadius: radii.radiusFull,
    backgroundColor: colors.success600, alignItems: 'center', justifyContent: 'center',
  },
  winnerAvatarText: {
    fontSize: fontSizes.fsBase, color: colors.white,
    fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold,
  },
  winnerName: {
    fontSize: fontSizes.fsSm, color: colors.white,
    fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold,
  },
  winnerCoop: { fontSize: 10.5, color: 'rgba(209, 250, 229, 0.8)', fontFamily: fontFamilies.interRegular, marginTop: 1 },
  scorePill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: radii.radiusFull,
    backgroundColor: 'rgba(6, 78, 59, 0.8)',
    borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.5)',
  },
  scorePillText: { fontSize: 11, color: colors.success100, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },

  winnerMetaRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    gap: spacing.space3, marginTop: spacing.space3,
  },
  winnerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  winnerMetaText: { fontSize: 11.5, color: colors.success100, fontFamily: fontFamilies.interSemiBold },
  winnerMetaMuted: { fontSize: 10, color: 'rgba(209, 250, 229, 0.65)', fontFamily: fontFamilies.interRegular },

  startRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: spacing.space3 },
  startText: { flex: 1, fontSize: 11, color: colors.primary100, fontFamily: fontFamilies.interMedium, lineHeight: 15 },

  verdict: {
    marginTop: spacing.space3,
    paddingTop: spacing.space3,
    borderTopWidth: 1,
    borderTopColor: 'rgba(16, 185, 129, 0.28)',
    fontSize: 11,
    color: 'rgba(209, 250, 229, 0.9)',
    fontFamily: fontFamilies.interRegular,
    lineHeight: 16,
  },
});
