import { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Clock, MapPin, X, Bell, Navigation, ChevronRight, ChevronDown,
  Wind, Droplet, Flame, Check, ShieldCheck, ArrowRight, Sparkles,
} from 'lucide-react-native';
import { useAuth } from '@context/AuthContext';
import { useLanguage } from '@context/LanguageContext';
import { mockServices, getServiceById, serviceName } from '@data/mockServices';
import { getBookingsByCustomer, resolveCustomerId } from '@data/mockBookings';
import { getComplaintsAgainstCustomer, useComplaints } from '@data/mockComplaints';
import { scheduleAdvisor } from '@services/complaintAdvisor';
import { serviceIcon } from '@components/icons';
import {
  ScreenContainer, SectionHeader, ServiceCardGrid, GradientBand, ComplaintAgainstYouCard,
} from '@components/app';
import Badge from '@components/ui/Badge';
import HelplineModal from '@components/HelplineModal';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * CustomerDashboardScreen — customer home.
 *
 * UI REDESIGN (frontend-only — data source, handlers, labels, and navigation all unchanged):
 *  - Real gradient header band (react-native-svg via GradientBand — no new native dep) holding
 *    the greeting + name (strongest element) + location + notifications bell + a floating search.
 *  - Gradient "Verified professionals. Fair prices. Always." cooperative hero; its CTA is the
 *    SAME goBook(undefined) the old PromoBanner used, with the same verification messaging.
 *  - Active booking presented as a live-tracking surface with a status stepper DERIVED FROM the
 *    existing status value (no invented states/ETA) + the existing Track action.
 *  - Reworked semantic "Service Reminders": overdue (warm/red), due-soon (blue), normal states;
 *    subtle icon containers; compact Book; the existing dismiss is preserved (subtle).
 *
 * PRESERVED exactly: getBookingsByCustomer(user?.id); activeBookings filter; displayName; the
 * MOCK_REMINDERS + daysUntil + dismiss + Book deep-link; bell -> HelplineModal; search -> goBook;
 * hero CTA -> goBook; services -> goBook({service}); "See all" -> BookingHistory; card ->
 * CustomerBookings; Track -> goTrack. No new shortcut/nav/actions added.
 */

const statusVariant = {
  'en-route': 'en-route', 'in-progress': 'in-progress', completed: 'completed',
  cancelled: 'cancelled', assigned: 'assigned', booked: 'default',
};

// Visual lifecycle used ONLY to position the existing status value on a stepper (invents no state).
// Labels resolved via t() inside the component (see LIFECYCLE below).
const STATUS_STEP = { booked: 0, assigned: 0, 'en-route': 1, 'in-progress': 2, completed: 2 };

// LanguageContext stores a code; the AI service wants the English language NAME.
const LANG_NAME = { en: 'English', hi: 'Hindi', bn: 'Bengali' };

const MOCK_REMINDERS = [
  { id: 1, service_id: 'ac-repair', service_name: 'AC Filter Cleaning', next_due_date: '2026-09-05', interval_days: 90, icon: '❄️' },
  { id: 2, service_id: 'plumbing', service_name: 'RO Water Purifier Service', next_due_date: '2026-09-12', interval_days: 60, icon: '💧' },
  { id: 3, service_id: 'cleaning', service_name: 'Chimney Deep Cleaning', next_due_date: '2026-09-20', interval_days: 45, icon: '🔥' },
];

// Subtle per-type icon containers (icon tinted; card stays mostly neutral).
const REMINDER_VISUAL = {
  'ac-repair': { Icon: Wind, color: colors.info600, tint: colors.info50 },
  plumbing: { Icon: Droplet, color: colors.info600, tint: colors.info50 },
  cleaning: { Icon: Flame, color: colors.accent600, tint: colors.accent50 },
};
const reminderVisual = (serviceId) => REMINDER_VISUAL[serviceId] || { Icon: Bell, color: colors.primary600, tint: colors.primary50 };

export default function CustomerDashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const { t, resolvedLanguage } = useLanguage();
  const LIFECYCLE = [t('step_confirmed'), t('step_on_the_way'), t('step_arriving')];
  const bookings = getBookingsByCustomer(user?.id);
  const activeBookings = bookings.filter((b) => ['en-route', 'in-progress', 'assigned'].includes(b.status));
  const [reminders, setReminders] = useState(MOCK_REMINDERS);
  const [showHelpline, setShowHelpline] = useState(false);

  /**
   * Complaints a WORKER has filed about this customer.
   *
   * resolveCustomerId is required: complaints store the booking's customerId, which for the demo
   * account is canonicalised to 'c1', while user.id is 'demo-customer'. Comparing the raw id would
   * silently match nothing.
   */
  useComplaints();
  const complaintsAgainstMe = getComplaintsAgainstCustomer(resolveCustomerId(user?.id));

  // Generate any missing suggestion in the background. Fire-and-forget; see complaintAdvisor.js.
  const awaitingAi = complaintsAgainstMe.filter((c) => c.aiStatus === 'idle').length;
  useEffect(() => {
    if (awaitingAi > 0) scheduleAdvisor(LANG_NAME[resolvedLanguage] || 'English');
  }, [awaitingAi, resolvedLanguage]);

  const displayName = profile?.full_name?.split(' ')[0] || user?.name?.split(' ')[0] || t('hi_there');
  // Time-based greeting, localized (reuses the existing good_morning/afternoon/evening keys).
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t('good_morning') : hour < 17 ? t('good_afternoon') : t('good_evening');

  const dismissReminder = (id) => setReminders((prev) => prev.filter((r) => r.id !== id));
  const daysUntil = (dateStr) => Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));

  const goBook = (params) => navigation.navigate('CustomerBook', params);
  const goTrack = (bookingId) => navigation.navigate('LiveTrackingMap', { bookingId });

  const active = activeBookings[0];
  const activeStep = active ? (STATUS_STEP[active.status] ?? -1) : -1;

  return (
    <ScreenContainer scroll style={styles.canvas} contentStyle={styles.content} edges={false}>
      {/* Gradient header band */}
      <GradientBand
        colors={['#4338ca', '#6d28d9', '#7c3aed']}
        angle="diagonal"
        decor
        style={[styles.headerBand, { paddingTop: insets.top + spacing.space4 }]}
      >
        <View style={styles.headerTopRow}>
          <View style={styles.greetWrap}>
            <Text style={styles.greetSmall}>{greeting},</Text>
            <Text style={styles.greetName} numberOfLines={1}>{displayName} 👋</Text>
            <View style={styles.locRow}>
              <MapPin size={13} color={colors.primary100} strokeWidth={2.2} />
              <Text style={styles.locText} numberOfLines={1}>Anandapur, Kolkata</Text>
              <ChevronDown size={13} color={colors.primary100} />
            </View>
          </View>
          <Pressable style={styles.bell} onPress={() => setShowHelpline(true)} accessibilityLabel="Notifications" hitSlop={8}>
            <Bell size={20} color={colors.white} />
            <View style={styles.bellDot} />
          </Pressable>
        </View>

      </GradientBand>

      <View style={styles.body}>
        {/* ---- A worker has reported an issue about this customer. Placed first in the body so it
                is not buried under promotional content. ---- */}
        {complaintsAgainstMe.map((c) => (
          <ComplaintAgainstYouCard key={c.id} complaint={c} filedByLabelKey="filed_by_worker" />
        ))}

        {/* Cooperative hero (gradient) — same CTA + verification messaging as before */}
        <GradientBand colors={['#4f46e5', '#7c3aed']} angle="diagonal" decor style={styles.hero}>
          <View style={styles.heroChip}>
            <ShieldCheck size={12} color={colors.accent300} />
            <Text style={styles.heroChipText}>{t('govt_backed_coop')}</Text>
          </View>
          <Text style={styles.heroTitle}>{t('hero_verified_title')}</Text>
          <Text style={styles.heroSub}>{t('hero_verified_sub')}</Text>
          <Pressable style={styles.heroCta} onPress={() => goBook(undefined)}>
            <Text style={styles.heroCtaText}>{t('book_a_service')}</Text>
            <ArrowRight size={15} color={colors.primary800} strokeWidth={2.4} />
          </Pressable>
        </GradientBand>

        {/* Active booking — live tracking surface */}
        {active && (
          <View style={styles.liveCard}>
            <View style={styles.liveTop}>
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>{t('live')}</Text>
              </View>
              <Pressable style={styles.trackBtn} onPress={() => goTrack(active.id)}>
                <Navigation size={13} color={colors.white} strokeWidth={2.4} />
                <Text style={styles.trackBtnText}>{t('track')}</Text>
              </Pressable>
            </View>
            <Text style={styles.liveTitle} numberOfLines={1}>{t('service_suffix', { name: serviceName(getServiceById(active.serviceId) || { id: active.serviceId, name: active.serviceName }, t) })}</Text>
            <Text style={styles.liveSub} numberOfLines={1}>
              {active.workerName ? t('is_on_the_way', { name: active.workerName }) : active.status.replace('-', ' ')}
            </Text>

            {activeStep >= 0 ? (
              <View style={styles.stepper}>
                {LIFECYCLE.map((label, i) => {
                  const done = i <= activeStep;
                  return (
                    <View key={label} style={styles.stepSeg}>
                      <View style={styles.stepLine}>
                        {i > 0 ? <View style={[styles.connector, i <= activeStep && styles.connectorDone]} /> : <View style={styles.connectorSpacer} />}
                        <View style={[styles.stepDot, done && styles.stepDotDone]}>
                          {done ? <Check size={9} color={colors.white} strokeWidth={3} /> : null}
                        </View>
                        {i < LIFECYCLE.length - 1 ? <View style={[styles.connector, i < activeStep && styles.connectorDone]} /> : <View style={styles.connectorSpacer} />}
                      </View>
                      <Text style={[styles.stepLabel, done && styles.stepLabelDone]} numberOfLines={1}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        )}

        {/* Service reminders */}
        {reminders.length > 0 && (
          <View style={styles.section}>
            <View style={styles.remindersHead}>
              <Text style={styles.sectionKicker}>{t('service_reminders_caps')}</Text>
              <Badge variant="warning" size="sm">{String(reminders.length)}</Badge>
              <View style={{ flex: 1 }} />
            </View>
            <Text style={styles.remindersSupport}>{t('reminders_support')}</Text>
            <View style={styles.remindersList}>
              {reminders.map((r) => {
                const days = daysUntil(r.next_due_date);
                const isOverdue = days <= 0;
                const isDueSoon = days > 0 && days <= 4;
                const { Icon, color, tint } = reminderVisual(r.service_id);
                const statusText = isOverdue ? t('overdue') : t('due_in_days', { days, unit: days !== 1 ? t('days') : t('day') });
                return (
                  <View
                    key={r.id}
                    style={[styles.reminderItem, isOverdue && styles.reminderOverdue, isDueSoon && styles.reminderDueSoon]}
                  >
                    <View style={[styles.reminderIconWrap, { backgroundColor: tint }]}>
                      <Icon size={19} color={color} strokeWidth={2} />
                    </View>
                    <View style={styles.reminderInfo}>
                      <Text style={styles.reminderName} numberOfLines={1}>{r.service_name}</Text>
                      <View style={styles.reminderMetaRow}>
                        <Text
                          style={[
                            styles.reminderStatus,
                            isOverdue && styles.statusOverdue,
                            isDueSoon && styles.statusDueSoon,
                          ]}
                        >
                          {statusText}
                        </Text>
                        <Text style={styles.reminderFreq} numberOfLines={1}>{t('every_days', { days: r.interval_days })}</Text>
                      </View>
                    </View>
                    <Pressable style={styles.reminderBook} onPress={() => goBook({ service: r.service_id, desc: r.service_name })}>
                      <Text style={styles.reminderBookText}>{t('book')}</Text>
                    </Pressable>
                    <Pressable style={styles.reminderDismiss} onPress={() => dismissReminder(r.id)} hitSlop={8} accessibilityLabel="Dismiss reminder">
                      <X size={16} color={colors.gray300} strokeWidth={2.2} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Services */}
        <View style={styles.section}>
          <View style={styles.servicesHead}>
            <Sparkles size={18} color={colors.primary600} strokeWidth={2.2} />
            <Text style={styles.servicesHeading}>{t('need_help_with')}</Text>
          </View>

          <ServiceCardGrid services={mockServices} onSelect={(s) => goBook({ service: s.id })} />
        </View>

        {/* Recent bookings */}
        <View style={styles.section}>
          <SectionHeader title={t('recent_bookings')} actionLabel={t('see_all_arrow')} onPressAction={() => navigation.navigate('BookingHistory')} />
          <View style={styles.bookingsList}>
            {bookings.slice(0, 3).map((b) => {
              const svc = getServiceById(b.serviceId);
              const Icon = serviceIcon(svc?.icon);
              const accent = svc?.color || colors.primary600;
              return (
                <Pressable key={b.id} style={styles.bookingCard} onPress={() => navigation.navigate('CustomerBookings')}>
                  <View style={[styles.bookingIcon, { backgroundColor: accent + '18' }]}>
                    <Icon size={20} color={accent} strokeWidth={2.2} />
                  </View>
                  <View style={styles.bookingInfo}>
                    <Text style={styles.bookingName} numberOfLines={1}>{serviceName(svc || { id: b.serviceId, name: b.serviceName }, t)}</Text>
                    <View style={styles.bookingMetaRow}>
                      <Clock size={11} color={colors.gray400} strokeWidth={2} />
                      <Text style={styles.bookingMeta} numberOfLines={1}>{b.date} • {b.time}</Text>
                    </View>
                    <View style={styles.bookingMetaRow}>
                      <MapPin size={11} color={colors.gray400} strokeWidth={2} />
                      <Text style={styles.bookingMeta} numberOfLines={1}>{b.address?.split(',')[0]}</Text>
                    </View>
                  </View>
                  <View style={styles.bookingRight}>
                    <Badge variant={statusVariant[b.status] || 'default'} size="sm">{b.status.replace('-', ' ')}</Badge>
                    <Text style={styles.bookingPrice}>₹{b.totalPrice}</Text>
                    {b.status === 'en-route' ? (
                      <Pressable style={styles.miniTrack} onPress={() => goTrack(b.id)}>
                        <Navigation size={11} color={colors.primary600} strokeWidth={2.2} />
                        <Text style={styles.miniTrackText}>{t('track')}</Text>
                      </Pressable>
                    ) : (
                      <ChevronRight size={16} color={colors.gray300} />
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      <HelplineModal isOpen={showHelpline} onClose={() => setShowHelpline(false)} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  canvas: { backgroundColor: colors.bgPrimary },
  content: { paddingHorizontal: 0, paddingTop: 0 },

  // ---- Header band ----
  headerBand: {
    borderBottomLeftRadius: radii.radius2xl,
    borderBottomRightRadius: radii.radius2xl,
    paddingHorizontal: spacing.space5,
    paddingBottom: spacing.space5,
    overflow: 'hidden',
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  greetWrap: { flex: 1 },
  greetSmall: { fontSize: fontSizes.fsSm, color: colors.primary100, fontFamily: fontFamilies.interRegular },
  greetName: { fontSize: fontSizes.fs3xl, color: colors.white, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, marginTop: 1 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.space2 },
  locText: { fontSize: fontSizes.fsSm, color: colors.white, fontFamily: fontFamilies.interMedium, fontWeight: fontWeights.fwMedium, flexShrink: 1, opacity: 0.95 },
  bell: {
    width: 42, height: 42, borderRadius: radii.radiusFull,
    backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute', top: 10, right: 11, width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.accent400, borderWidth: 1.5, borderColor: '#5b21b6',
  },
  // ---- Body ----
  body: { paddingHorizontal: spacing.space4, paddingTop: spacing.space5 },
  section: { marginTop: spacing.space6 },

  // ---- Hero ----
  hero: { borderRadius: radii.radiusXl, padding: spacing.space5, overflow: 'hidden', ...shadows.shadowLg, shadowColor: '#4338ca' },
  heroChip: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.14)', paddingVertical: 4, paddingHorizontal: 9,
    borderRadius: radii.radiusFull, marginBottom: spacing.space3,
  },
  heroChipText: { fontSize: 10, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.primary100, letterSpacing: 0.2 },
  heroTitle: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.white, lineHeight: fontSizes.fsXl * 1.25 },
  heroSub: { fontSize: fontSizes.fsXs, color: colors.primary100, fontFamily: fontFamilies.interRegular, marginTop: spacing.space2, marginBottom: spacing.space4, maxWidth: '90%', lineHeight: fontSizes.fsXs * 1.45 },
  heroCta: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, backgroundColor: colors.white, paddingVertical: spacing.space3, paddingHorizontal: spacing.space5, borderRadius: radii.radiusMd },
  heroCtaText: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.primary800 },

  // ---- Live booking ----
  liveCard: {
    marginTop: spacing.space5, backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl,
    padding: spacing.space4, borderWidth: 1, borderColor: colors.success100, ...shadows.shadowSm,
  },
  liveTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.success50, paddingVertical: 4, paddingHorizontal: 9, borderRadius: radii.radiusFull },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success500 },
  liveText: { fontSize: 10, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.success700, letterSpacing: 0.5 },
  trackBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary700, paddingVertical: spacing.space2, paddingHorizontal: spacing.space4, borderRadius: radii.radiusMd },
  trackBtnText: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },
  liveTitle: { fontSize: fontSizes.fsLg, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900, marginTop: spacing.space3 },
  liveSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  stepper: { flexDirection: 'row', marginTop: spacing.space4 },
  stepSeg: { flex: 1, alignItems: 'center' },
  stepLine: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  connector: { flex: 1, height: 2, backgroundColor: colors.gray200 },
  connectorDone: { backgroundColor: colors.success500 },
  connectorSpacer: { flex: 1 },
  stepDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.gray300, backgroundColor: colors.surfaceWhite, alignItems: 'center', justifyContent: 'center' },
  stepDotDone: { backgroundColor: colors.success500, borderColor: colors.success500 },
  stepLabel: { fontSize: 10, color: colors.gray400, fontFamily: fontFamilies.interMedium, marginTop: 4 },
  stepLabelDone: { color: colors.success700, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },

  // ---- Reminders ----
  remindersHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  sectionKicker: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray700, letterSpacing: 1 },
  remindersSupport: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 4, marginBottom: spacing.space3, lineHeight: fontSizes.fsXs * 1.4 },
  remindersList: { gap: spacing.space2 },
  reminderItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg,
    paddingVertical: spacing.space3, paddingHorizontal: spacing.space3,
    borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm,
  },
  reminderOverdue: { backgroundColor: '#fef4f4', borderColor: colors.danger100 },
  reminderDueSoon: { backgroundColor: colors.info50, borderColor: colors.info100 },
  reminderIconWrap: { width: 42, height: 42, borderRadius: radii.radiusMd, alignItems: 'center', justifyContent: 'center' },
  reminderInfo: { flex: 1 },
  reminderName: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.gray900 },
  reminderMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  reminderStatus: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },
  statusOverdue: { color: colors.danger600 },
  statusDueSoon: { color: colors.info700 },
  reminderFreq: { fontSize: fontSizes.fsXs, color: colors.gray400, fontFamily: fontFamilies.interRegular, flexShrink: 1 },
  reminderBook: { backgroundColor: colors.primary700, paddingVertical: spacing.space2, paddingHorizontal: spacing.space4, borderRadius: radii.radiusMd },
  reminderBookText: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.white },
  reminderDismiss: { padding: 2 },

  // ---- Services ----
  servicesHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2, marginBottom: spacing.space3 },
  servicesHeading: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwExtrabold, fontFamily: fontFamilies.interExtraBold, color: colors.gray900 },
  // ---- Recent bookings ----
  bookingsList: { gap: spacing.space3 },
  bookingCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space4,
    borderWidth: 1, borderColor: colors.gray100, ...shadows.shadowSm,
  },
  bookingIcon: { width: 42, height: 42, borderRadius: radii.radiusMd, alignItems: 'center', justifyContent: 'center' },
  bookingInfo: { flex: 1, gap: 2 },
  bookingName: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.gray900, marginBottom: 1 },
  bookingMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bookingMeta: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, flexShrink: 1 },
  bookingRight: { alignItems: 'flex-end', gap: spacing.space1 },
  bookingPrice: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  miniTrack: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  miniTrackText: { fontSize: fontSizes.fsXs, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.primary600 },
});
