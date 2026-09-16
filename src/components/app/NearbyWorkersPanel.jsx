import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Navigation2, MapPin, Star, BadgeCheck, Users, AlertCircle } from 'lucide-react-native';
import { useLanguage } from '@context/LanguageContext';
import { formatDistance, RADIUS_OPTIONS_KM } from '@utils/distance';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * Ranked nearby professionals for the service the customer is booking.
 *
 * PRESENTATION ONLY. Every worker, distance and score shown here comes from geoMatchingService — this
 * component runs no matching of its own, so what the customer sees cannot diverge from what the engine
 * decided.
 *
 * WHY THIS IS INFORMATIONAL RATHER THAN A PICKER:
 * This app is a worker-PULL marketplace. A booking is created unassigned, enters the job feed, and a
 * worker accepts it — `acceptBooking` is the single point where a job gains a professional, and it
 * enforces the one-active-job rule there. Turning this list into "customer assigns worker X" would
 * invert that model and bypass those store-level guarantees. So the panel builds confidence by showing
 * the customer that real, eligible, nearby workers exist for their request, while the assignment itself
 * stays with the existing flow. That keeps the booking pipeline untouched.
 *
 * PRIVACY: only an approximate distance is ever rendered ("1.4 km away"). Neither the worker's nor the
 * customer's coordinates are displayed, even though both are known internally.
 */
export default function NearbyWorkersPanel({ result, loading, radiusKm, onWidenRadius }) {
  const { t } = useLanguage();

  if (loading) {
    return (
      <View style={styles.wrap}>
        <View style={styles.headRow}>
          <Users size={16} color={colors.primary700} strokeWidth={2.3} />
          <Text style={styles.title}>{t('nearby_professionals')}</Text>
        </View>
        <View style={styles.centerBox}>
          <ActivityIndicator size="small" color={colors.primary600} />
          <Text style={styles.muted}>{t('locating')}</Text>
        </View>
      </View>
    );
  }

  if (!result) return null;

  const { workers, meta } = result;

  // The next radius up, for the "widen the search" affordance. Undefined at the largest option, in
  // which case no widen button is offered rather than a dead control.
  const nextRadius = RADIUS_OPTIONS_KM.find((r) => r > radiusKm);

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Users size={16} color={colors.primary700} strokeWidth={2.3} />
        <Text style={styles.title}>{t('nearby_professionals')}</Text>
      </View>

      {workers.length === 0 ? (
        <>
          {/* An honest empty state. Distant workers are NOT shown here as a consolation — presenting
              someone 20 km away as "nearby" would mislead the customer about response time. */}
          <View style={styles.emptyBox}>
            <AlertCircle size={22} color={colors.warning600} strokeWidth={2.2} />
            <Text style={styles.emptyText}>{t('nearby_none')}</Text>
          </View>
          {nextRadius && (
            <Pressable style={styles.widenBtn} onPress={() => onWidenRadius(nextRadius)}>
              <Navigation2 size={14} color={colors.primary700} strokeWidth={2.3} />
              <Text style={styles.widenText}>{t('nearby_widen', { radius: nextRadius })}</Text>
            </Pressable>
          )}
        </>
      ) : (
        <>
          <Text style={styles.countText}>
            {t('nearby_count', { count: workers.length, radius: meta.radiusKm })}
          </Text>

          {/* Shown when GPS was unavailable and matching fell back to the saved service address, so
              the customer knows the distances are relative to that rather than to where they stand. */}
          {meta.usedFallbackOrigin && (
            <View style={styles.fallbackRow}>
              <MapPin size={11} color={colors.gray500} strokeWidth={2.2} />
              <Text style={styles.fallbackText}>{t('loc_unavailable_desc')}</Text>
            </View>
          )}

          <View style={styles.list}>
            {workers.slice(0, 4).map((w, i) => (
              <View key={w.workerId} style={styles.card}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{(w.name || '?')[0]}</Text>
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{w.name}</Text>
                    {/* Only the top-ranked worker is badged, so "best match" stays meaningful. */}
                    {i === 0 && (
                      <View style={styles.bestPill}>
                        <BadgeCheck size={10} color={colors.success700} strokeWidth={2.6} />
                        <Text style={styles.bestText}>{t('best_match')}</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.metaRow}>
                    <Navigation2 size={11} color={colors.success600} strokeWidth={2.3} />
                    <Text style={styles.distance}>{t('km_away', { distance: formatDistance(w.distanceKm) })}</Text>
                    {w.rating != null && (
                      <>
                        <Star size={11} color={colors.accent500} fill={colors.accent500} strokeWidth={0} />
                        <Text style={styles.rating}>{w.rating.toFixed(1)}</Text>
                      </>
                    )}
                  </View>

                  {w.cooperative && (
                    <Text style={styles.coop} numberOfLines={1}>{w.cooperative}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.space4,
    padding: spacing.space4,
    backgroundColor: colors.primary50,
    borderRadius: radii.radiusXl,
    borderWidth: 1,
    borderColor: colors.primary100,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  title: {
    fontSize: fontSizes.fsBase,
    fontFamily: fontFamilies.interBold,
    fontWeight: fontWeights.fwBold,
    color: colors.primary900,
  },
  countText: {
    fontSize: fontSizes.fsXs,
    color: colors.gray600,
    fontFamily: fontFamilies.interMedium,
    marginTop: 3,
  },
  fallbackRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginTop: spacing.space2 },
  fallbackText: { fontSize: 10.5, color: colors.gray500, fontFamily: fontFamilies.interRegular, flex: 1, lineHeight: 15 },

  centerBox: { alignItems: 'center', gap: spacing.space2, paddingVertical: spacing.space5 },
  muted: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },

  emptyBox: { alignItems: 'center', gap: spacing.space2, paddingVertical: spacing.space4 },
  emptyText: {
    fontSize: fontSizes.fsXs,
    color: colors.gray600,
    fontFamily: fontFamilies.interRegular,
    textAlign: 'center',
    lineHeight: 17,
  },
  widenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: spacing.space3, borderRadius: radii.radiusMd,
    backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.primary200,
  },
  widenText: {
    fontSize: fontSizes.fsSm, color: colors.primary700,
    fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold,
  },

  list: { gap: spacing.space2, marginTop: spacing.space3 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    backgroundColor: colors.white, borderRadius: radii.radiusLg,
    padding: spacing.space3, ...shadows.shadowSm,
  },
  avatar: {
    width: 36, height: 36, borderRadius: radii.radiusFull,
    backgroundColor: colors.primary100, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: {
    fontSize: fontSizes.fsSm, color: colors.primary700,
    fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  name: {
    fontSize: fontSizes.fsSm, color: colors.gray900,
    fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold, flexShrink: 1,
  },
  bestPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingVertical: 2, paddingHorizontal: 6,
    backgroundColor: colors.success50, borderRadius: radii.radiusFull,
  },
  bestText: {
    fontSize: 9, color: colors.success700,
    fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  distance: {
    fontSize: 11, color: colors.success700,
    fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold,
  },
  rating: { fontSize: 11, color: colors.gray600, fontFamily: fontFamilies.interMedium, marginLeft: 2 },
  coop: { fontSize: 10, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },
});
