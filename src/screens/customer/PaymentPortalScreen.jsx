import { useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft, Smartphone, CreditCard, Wallet, ShieldAlert, Check, CheckCircle2,
  Download, Share2, Star, MessageSquareWarning, ChevronRight, IndianRupee,
} from 'lucide-react-native';
import { getBookingById, payBooking, saveBookingFeedback, useBookings } from '@data/mockBookings';
import { addComplaint } from '@data/mockComplaints';
import { recordCompletedJob } from '@data/workerStats';
import { buildReceiptText, shareReceipt } from '@utils/receipt';
import { useLanguage } from '@context/LanguageContext';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * PaymentPortalScreen — the customer's pay → receipt → feedback flow for a completed job.
 *
 * FOUR STEPS IN ONE STACK SCREEN rather than four routes: the steps share one booking and one
 * draft of the customer's rating/feedback/complaint, and they are strictly linear with no reason
 * to deep-link into the middle. Separate routes would mean threading that draft through navigation
 * params and would let the back gesture drop the customer into a half-finished payment.
 *
 *   method  → choose UPI / card / cash
 *   receipt → the tax invoice (reuses utils/receipt buildReceiptText) + download/share
 *   done    → "paid successfully", star rating, written feedback, optional complaint
 *
 * PAYMENT IS SIMULATED. There is no gateway integration, no card data is validated, stored or
 * transmitted, and the "processing" pause is a timer. The UPI id / card number inputs are
 * deliberately cosmetic so the demo looks right without implying real capture.
 */

const METHODS = [
  { id: 'upi', labelKey: 'pay_upi', descKey: 'pay_upi_desc', Icon: Smartphone },
  { id: 'card', labelKey: 'pay_card', descKey: 'pay_card_desc', Icon: CreditCard },
  { id: 'cash', labelKey: 'pay_cash', descKey: 'pay_cash_desc', Icon: Wallet },
];

export default function PaymentPortalScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  useBookings();

  const bookingId = route?.params?.bookingId;
  const booking = getBookingById(bookingId);

  const [step, setStep] = useState('method');
  const [method, setMethod] = useState('upi');
  const [processing, setProcessing] = useState(false);

  // Cosmetic only — never read back, never stored. See the header note.
  const [upiId, setUpiId] = useState('');
  const [cardNo, setCardNo] = useState('');

  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [complaintOpen, setComplaintOpen] = useState(false);
  const [complaintSubject, setComplaintSubject] = useState('');
  const [complaintBody, setComplaintBody] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!booking) {
    return (
      <View style={[styles.page, { paddingTop: insets.top + spacing.space6 }]}>
        <Text style={styles.missing}>{t('booking_not_found')}</Text>
        <Pressable style={styles.primaryBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.primaryBtnText}>{t('go_back')}</Text>
        </Pressable>
      </View>
    );
  }

  const amount = booking.totalPrice;

  const handlePay = () => {
    setProcessing(true);
    // Simulated settlement delay so the flow reads like a real gateway hand-off.
    setTimeout(() => {
      payBooking(booking.id, { method });
      setProcessing(false);
      setStep('receipt');
    }, 1400);
  };

  /**
   * Commits the customer's rating/feedback (and complaint, if raised) and credits the worker.
   * This is the single point where the worker's earnings, hours, rating and quality score move —
   * doing it here rather than at "Job done" means the worker is only paid for work actually paid
   * for, and the score reflects the rating the customer just gave.
   */
  const handleFinish = ({ skipped = false } = {}) => {
    const hasComplaint = !skipped && complaintOpen && complaintSubject.trim().length > 0;

    if (!skipped) {
      saveBookingFeedback(booking.id, { rating: rating || null, feedback: feedback.trim() });
    }

    if (hasComplaint) {
      addComplaint({
        customerId: booking.customerId,
        customerName: booking.customerName,
        workerId: booking.workerId,
        workerName: booking.workerName,
        bookingId: booking.id,
        serviceName: booking.serviceName,
        subject: complaintSubject.trim(),
        description: complaintBody.trim() || complaintSubject.trim(),
      });
    }

    // Credit the worker regardless of whether feedback was given — the money has changed hands,
    // so the earnings, hours and job count must move either way. Only the rating is optional.
    recordCompletedJob(booking.workerId, {
      amount,
      rating: skipped ? null : rating || null,
      hasComplaint,
      bookingId: booking.id,
      hours: booking.durationHours ?? 2,
    });

    if (!skipped) setSubmitted(true);
  };

  /** Leaves without rating, but still settles the worker's side. */
  const handleSkip = () => {
    handleFinish({ skipped: true });
    navigation.navigate('CustomerTabs');
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.space3, paddingBottom: insets.bottom + spacing.space8 }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* ---- Top bar ---- */}
      <View style={styles.topBar}>
        <Pressable style={styles.back} onPress={() => navigation.goBack()} accessibilityLabel={t('go_back')}>
          <ArrowLeft size={20} color={colors.gray700} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle}>
            {step === 'method' ? t('payment_portal') : step === 'receipt' ? t('your_receipt') : t('payment_complete')}
          </Text>
          <Text style={styles.topSub} numberOfLines={1}>{booking.serviceName} · #{booking.id}</Text>
        </View>
      </View>

      {/* ================= STEP 1: choose a method ================= */}
      {step === 'method' && (
        <>
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>{t('amount_payable')}</Text>
            <View style={styles.amountRow}>
              <IndianRupee size={24} color={colors.gray900} strokeWidth={2.6} />
              <Text style={styles.amountValue}>{amount}</Text>
            </View>
            <Text style={styles.amountNote}>{t('amount_incl_taxes')}</Text>
          </View>

          <View style={styles.warnBox}>
            <ShieldAlert size={15} color={colors.danger700} strokeWidth={2.3} />
            <Text style={styles.warnText}>{t('payment_due_warning')}</Text>
          </View>

          <Text style={styles.sectionLabel}>{t('choose_payment_method')}</Text>
          <View style={styles.methodList}>
            {METHODS.map((m) => {
              const on = method === m.id;
              return (
                <Pressable
                  key={m.id}
                  style={[styles.method, on && styles.methodOn]}
                  onPress={() => setMethod(m.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <View style={[styles.methodIcon, on && styles.methodIconOn]}>
                    <m.Icon size={18} color={on ? colors.primary700 : colors.gray500} strokeWidth={2.3} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.methodLabel, on && styles.methodLabelOn]}>{t(m.labelKey)}</Text>
                    <Text style={styles.methodDesc}>{t(m.descKey)}</Text>
                  </View>
                  <View style={[styles.radio, on && styles.radioOn]}>{on && <Check size={12} color={colors.white} strokeWidth={3} />}</View>
                </Pressable>
              );
            })}
          </View>

          {/* Cosmetic detail fields, shown to match the chosen method. */}
          {method === 'upi' && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('upi_id')}</Text>
              <TextInput
                style={styles.input}
                value={upiId}
                onChangeText={setUpiId}
                placeholder="name@bank"
                placeholderTextColor={colors.gray400}
                autoCapitalize="none"
              />
            </View>
          )}
          {method === 'card' && (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('card_number')}</Text>
              <TextInput
                style={styles.input}
                value={cardNo}
                onChangeText={setCardNo}
                placeholder="0000 0000 0000 0000"
                placeholderTextColor={colors.gray400}
                keyboardType="number-pad"
              />
            </View>
          )}
          {method === 'cash' && (
            <View style={styles.cashNote}>
              <Text style={styles.cashNoteText}>{t('pay_cash_note')}</Text>
            </View>
          )}

          <Pressable style={[styles.primaryBtn, processing && styles.primaryBtnDisabled]} onPress={handlePay} disabled={processing}>
            {processing ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.primaryBtnText}>
                {method === 'cash' ? t('confirm_cash_payment') : t('pay_amount', { amount })}
              </Text>
            )}
          </Pressable>
          <Text style={styles.demoNote}>{t('payment_demo_note')}</Text>
        </>
      )}

      {/* ================= STEP 2: receipt ================= */}
      {step === 'receipt' && (
        <>
          <View style={styles.paidBanner}>
            <CheckCircle2 size={18} color={colors.success700} strokeWidth={2.4} />
            <Text style={styles.paidBannerText}>{t('payment_received_via', { method: t(METHODS.find((m) => m.id === method)?.labelKey) })}</Text>
          </View>

          <Text style={styles.sectionLabel}>{t('tax_invoice')}</Text>
          <View style={styles.receiptCard}>
            <Text style={styles.receiptText}>{buildReceiptText(booking)}</Text>
          </View>

          <View style={styles.receiptActions}>
            <Pressable style={styles.secondaryBtn} onPress={() => shareReceipt(booking)}>
              <Download size={16} color={colors.primary700} strokeWidth={2.3} />
              <Text style={styles.secondaryBtnText}>{t('download_invoice')}</Text>
            </Pressable>
            <Pressable style={styles.secondaryBtn} onPress={() => shareReceipt(booking)}>
              <Share2 size={16} color={colors.primary700} strokeWidth={2.3} />
              <Text style={styles.secondaryBtnText}>{t('share_invoice')}</Text>
            </Pressable>
          </View>

          <Pressable style={styles.primaryBtn} onPress={() => setStep('done')}>
            <Text style={styles.primaryBtnText}>{t('continue')}</Text>
            <ChevronRight size={16} color={colors.white} />
          </Pressable>
        </>
      )}

      {/* ================= STEP 3: success + feedback ================= */}
      {step === 'done' && (
        <>
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <CheckCircle2 size={34} color={colors.success600} strokeWidth={2.2} />
            </View>
            <Text style={styles.successTitle}>{t('paid_successfully')}</Text>
            <Text style={styles.successSub}>{t('paid_successfully_sub', { amount, id: booking.id })}</Text>
          </View>

          {submitted ? (
            <View style={styles.thanksCard}>
              <Text style={styles.thanksTitle}>{t('feedback_thanks_title')}</Text>
              <Text style={styles.thanksSub}>{t('feedback_thanks_sub')}</Text>
              <Pressable style={styles.primaryBtn} onPress={() => navigation.navigate('CustomerTabs')}>
                <Text style={styles.primaryBtnText}>{t('back_to_home')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* ---- Rating ---- */}
              <Text style={styles.sectionLabel}>{t('rate_your_experience')}</Text>
              <View style={styles.starRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setRating(n)}
                    accessibilityRole="button"
                    accessibilityLabel={t('rate_n_stars', { n })}
                    hitSlop={6}
                  >
                    <Star
                      size={34}
                      color={n <= rating ? colors.accent500 : colors.gray300}
                      fill={n <= rating ? colors.accent500 : 'transparent'}
                      strokeWidth={2}
                    />
                  </Pressable>
                ))}
              </View>

              {/* ---- Written feedback ---- */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t('your_feedback')}</Text>
                <TextInput
                  style={[styles.input, styles.textarea]}
                  value={feedback}
                  onChangeText={setFeedback}
                  placeholder={t('feedback_placeholder')}
                  placeholderTextColor={colors.gray400}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>

              {/* ---- Separate complaint, deliberately opt-in ---- */}
              {!complaintOpen ? (
                <Pressable style={styles.complaintToggle} onPress={() => setComplaintOpen(true)}>
                  <MessageSquareWarning size={16} color={colors.danger600} strokeWidth={2.3} />
                  <Text style={styles.complaintToggleText}>{t('file_a_complaint')}</Text>
                </Pressable>
              ) : (
                <View style={styles.complaintBox}>
                  <Text style={styles.complaintTitle}>{t('file_a_complaint')}</Text>
                  <Text style={styles.complaintNote}>{t('complaint_note')}</Text>
                  <TextInput
                    style={styles.input}
                    value={complaintSubject}
                    onChangeText={setComplaintSubject}
                    placeholder={t('complaint_subject_placeholder')}
                    placeholderTextColor={colors.gray400}
                  />
                  <TextInput
                    style={[styles.input, styles.textarea]}
                    value={complaintBody}
                    onChangeText={setComplaintBody}
                    placeholder={t('complaint_body_placeholder')}
                    placeholderTextColor={colors.gray400}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                  <Pressable onPress={() => setComplaintOpen(false)}>
                    <Text style={styles.complaintCancel}>{t('remove_complaint')}</Text>
                  </Pressable>
                </View>
              )}

              <Pressable style={styles.primaryBtn} onPress={() => handleFinish()}>
                <Text style={styles.primaryBtnText}>{t('submit_feedback')}</Text>
              </Pressable>
              <Pressable onPress={handleSkip}>
                <Text style={styles.skipText}>{t('skip_for_now')}</Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surfaceCanvas || colors.gray50 },
  content: { paddingHorizontal: spacing.space4, gap: spacing.space4 },
  missing: { fontSize: fontSizes.fsBase, color: colors.gray600, fontFamily: fontFamilies.interRegular, textAlign: 'center', marginBottom: spacing.space4 },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3 },
  back: {
    width: 38, height: 38, borderRadius: radii.radiusFull, backgroundColor: colors.surfaceWhite,
    alignItems: 'center', justifyContent: 'center', ...shadows.shadowSm,
  },
  topTitle: { fontSize: fontSizes.fsLg, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  topSub: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },

  amountCard: {
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, padding: spacing.space5,
    alignItems: 'center', borderWidth: 1, borderColor: colors.gray200, ...shadows.shadowSm,
  },
  amountLabel: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interMedium, textTransform: 'uppercase', letterSpacing: 0.6 },
  amountRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.space1 },
  amountValue: { fontSize: 38, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  amountNote: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },

  warnBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.space2,
    backgroundColor: colors.danger50, borderRadius: radii.radiusMd, padding: spacing.space3,
    borderWidth: 1, borderColor: colors.danger200,
  },
  warnText: { flex: 1, fontSize: fontSizes.fsXs, color: colors.danger700, fontFamily: fontFamilies.interMedium, lineHeight: 16 },

  sectionLabel: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },

  methodList: { gap: spacing.space2 },
  method: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space3,
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space3,
    borderWidth: 1.5, borderColor: colors.gray200,
  },
  methodOn: { borderColor: colors.primary400, backgroundColor: colors.primary50 },
  methodIcon: {
    width: 38, height: 38, borderRadius: radii.radiusFull, backgroundColor: colors.gray100,
    alignItems: 'center', justifyContent: 'center',
  },
  methodIconOn: { backgroundColor: colors.primary100 },
  methodLabel: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold, color: colors.gray800 },
  methodLabelOn: { color: colors.primary800 },
  methodDesc: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular, marginTop: 1 },
  radio: {
    width: 20, height: 20, borderRadius: radii.radiusFull, borderWidth: 1.5, borderColor: colors.gray300,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.primary600, borderColor: colors.primary600 },

  field: { gap: spacing.space1 },
  fieldLabel: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwMedium, fontFamily: fontFamilies.interMedium, color: colors.gray700 },
  input: {
    paddingVertical: spacing.space3, paddingHorizontal: spacing.space4,
    borderWidth: 1.5, borderColor: colors.gray200, borderRadius: radii.radiusMd,
    fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interRegular, color: colors.gray900,
    backgroundColor: colors.surfaceWhite,
  },
  textarea: { minHeight: 96 },
  cashNote: {
    backgroundColor: colors.warning50, borderRadius: radii.radiusMd, padding: spacing.space3,
    borderWidth: 1, borderColor: colors.warning200,
  },
  cashNoteText: { fontSize: fontSizes.fsXs, color: colors.warning800, fontFamily: fontFamilies.interMedium, lineHeight: 16 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.space1,
    backgroundColor: colors.primary700, borderRadius: radii.radiusMd, paddingVertical: spacing.space4,
  },
  primaryBtnDisabled: { opacity: 0.7 },
  primaryBtnText: { color: colors.white, fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold },
  demoNote: { fontSize: fontSizes.fsXs, color: colors.gray400, fontFamily: fontFamilies.interRegular, textAlign: 'center' },

  paidBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.space2,
    backgroundColor: colors.success50, borderRadius: radii.radiusMd, padding: spacing.space3,
    borderWidth: 1, borderColor: colors.success100,
  },
  paidBannerText: { flex: 1, fontSize: fontSizes.fsSm, color: colors.success700, fontFamily: fontFamilies.interSemiBold, fontWeight: fontWeights.fwSemibold },

  receiptCard: {
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusLg, padding: spacing.space4,
    borderWidth: 1, borderColor: colors.gray200,
  },
  receiptText: { fontSize: fontSizes.fsXs, color: colors.gray800, fontFamily: 'monospace', lineHeight: 18 },
  receiptActions: { flexDirection: 'row', gap: spacing.space2 },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.space2,
    backgroundColor: colors.primary50, borderRadius: radii.radiusMd, paddingVertical: spacing.space3,
    borderWidth: 1, borderColor: colors.primary100,
  },
  secondaryBtnText: { fontSize: fontSizes.fsXs, color: colors.primary700, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold },

  successCard: {
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, padding: spacing.space6,
    alignItems: 'center', gap: spacing.space2, borderWidth: 1, borderColor: colors.success100, ...shadows.shadowSm,
  },
  successIcon: {
    width: 64, height: 64, borderRadius: radii.radiusFull, backgroundColor: colors.success50,
    alignItems: 'center', justifyContent: 'center',
  },
  successTitle: { fontSize: fontSizes.fsXl, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900, textAlign: 'center' },
  successSub: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interRegular, textAlign: 'center', lineHeight: 20 },

  starRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.space2 },

  complaintToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.space2,
    paddingVertical: spacing.space3, borderRadius: radii.radiusMd,
    borderWidth: 1.5, borderColor: colors.danger200, backgroundColor: colors.danger50,
  },
  complaintToggleText: { fontSize: fontSizes.fsSm, color: colors.danger700, fontWeight: fontWeights.fwSemibold, fontFamily: fontFamilies.interSemiBold },
  complaintBox: {
    gap: spacing.space2, padding: spacing.space4, borderRadius: radii.radiusLg,
    borderWidth: 1.5, borderColor: colors.danger200, backgroundColor: colors.danger50,
  },
  complaintTitle: { fontSize: fontSizes.fsSm, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.danger700 },
  complaintNote: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, lineHeight: 16 },
  complaintCancel: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interMedium, textAlign: 'center', paddingVertical: spacing.space1 },

  thanksCard: {
    backgroundColor: colors.surfaceWhite, borderRadius: radii.radiusXl, padding: spacing.space5,
    gap: spacing.space3, borderWidth: 1, borderColor: colors.gray200,
  },
  thanksTitle: { fontSize: fontSizes.fsBase, fontWeight: fontWeights.fwBold, fontFamily: fontFamilies.interBold, color: colors.gray900 },
  thanksSub: { fontSize: fontSizes.fsSm, color: colors.gray600, fontFamily: fontFamilies.interRegular, lineHeight: 20 },

  skipText: { fontSize: fontSizes.fsSm, color: colors.gray500, fontFamily: fontFamilies.interMedium, textAlign: 'center' },
});
