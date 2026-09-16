import { useState } from 'react';
import { View, Text, Pressable, TextInput, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import { ShieldCheck, Fingerprint, X as XIcon, CheckCircle, Lock, ChevronRight } from 'lucide-react-native';
import { useLanguage } from '@context/LanguageContext';
import { EKYC_VERIFIED } from '@data/workerRegistration';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * Aadhaar e-KYC — the third verification route offered at worker sign-up.
 *
 * ============================================================================
 * THIS IS A SIMULATION. Read before wiring anything real to it.
 * ============================================================================
 * There is no UIDAI / DigiLocker integration. Nothing is transmitted anywhere. The Aadhaar number
 * is validated only for shape (12 digits), the OTP is accepted on length alone, and both "sending"
 * pauses are timers — exactly the approach PaymentPortalScreen takes for payments, so the demo reads
 * convincingly without implying real capture.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, because a demo that mishandles Aadhaar data teaches the wrong
 * habit even in a prototype:
 *   * the full Aadhaar number is never stored, never logged, and never leaves this component's state
 *   * only the LAST FOUR DIGITS are handed back, which is the standard way to display a reference
 *   * the entered number is not written to MMKV, Supabase, or any analytics
 *
 * A real integration replaces handleVerify's timer with an API call and returns the same object
 * shape, so the data layer and every consumer stay unchanged.
 *
 * The returned payload mirrors a genuine e-KYC response:
 *   { status, aadhaarLast4, name, occupation, verifiedAt, method }
 *
 * `occupation` is the part that makes this a skill-verification route rather than a bare ID check —
 * India's e-Shram registry records a worker's trade alongside their identity, so a real pull returns
 * it. See the note on EKYC_VERIFIED in src/data/workerRegistration.js.
 */

/** Any 6 digits are accepted. Shown as a hint so nobody hunts for a real OTP. */
const DEMO_OTP = '123456';

/** Simulated latency, matching PaymentPortalScreen's 1400ms settlement pause. */
const SEND_OTP_MS = 1200;
const VERIFY_MS = 1400;

export default function EkycModal({ isOpen, onClose, onVerified, fullName, occupation }) {
  const { t } = useLanguage();

  // 'aadhaar' -> 'otp' -> 'done'
  const [step, setStep] = useState('aadhaar');
  const [aadhaar, setAadhaar] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const digits = aadhaar.replace(/\D/g, '');
  const otpDigits = otp.replace(/\D/g, '');

  const reset = () => {
    setStep('aadhaar');
    setAadhaar('');
    setOtp('');
    setBusy(false);
    setError('');
  };

  const close = () => {
    reset();
    onClose?.();
  };

  /** Groups as 1234 5678 9012 while typing, the way Aadhaar is conventionally shown. */
  const onAadhaarChange = (raw) => {
    const d = raw.replace(/\D/g, '').slice(0, 12);
    setAadhaar(d.replace(/(\d{4})(?=\d)/g, '$1 ').trim());
    setError('');
  };

  const handleSendOtp = () => {
    if (digits.length !== 12) {
      setError(t('ekyc_invalid_aadhaar'));
      return;
    }
    setError('');
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setStep('otp');
    }, SEND_OTP_MS);
  };

  const handleVerify = () => {
    if (otpDigits.length !== 6) {
      setError(t('ekyc_invalid_otp'));
      return;
    }
    setError('');
    setBusy(true);

    setTimeout(() => {
      setBusy(false);
      setStep('done');

      // Only the last four digits survive. `digits` itself is dropped when this component unmounts.
      onVerified?.({
        status: EKYC_VERIFIED,
        aadhaarLast4: digits.slice(-4),
        name: fullName || null,
        occupation: occupation || null,
        verifiedAt: new Date().toISOString(),
        method: 'aadhaar-otp',
      });
    }, VERIFY_MS);
  };

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* ---- header ---- */}
          <View style={styles.head}>
            <View style={styles.headIcon}>
              <Fingerprint size={22} color={colors.primary700} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('ekyc_title')}</Text>
              <Text style={styles.subtitle}>{t('ekyc_subtitle')}</Text>
            </View>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel={t('cancel')}>
              <XIcon size={20} color={colors.gray500} />
            </Pressable>
          </View>

          {/* Honesty banner. A simulated identity check must say so on screen, not just in a comment. */}
          <View style={styles.demoBanner}>
            <Lock size={13} color={colors.accent700} strokeWidth={2.2} />
            <Text style={styles.demoBannerText}>{t('ekyc_demo_notice')}</Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* ---- step 1: Aadhaar number ---- */}
          {step === 'aadhaar' && (
            <>
              <Text style={styles.label}>{t('ekyc_aadhaar_label')}</Text>
              <TextInput
                style={styles.input}
                value={aadhaar}
                onChangeText={onAadhaarChange}
                placeholder="1234 5678 9012"
                placeholderTextColor={colors.gray400}
                keyboardType="number-pad"
                maxLength={14}
                accessibilityLabel={t('ekyc_aadhaar_label')}
              />
              <Text style={styles.hint}>{t('ekyc_aadhaar_hint')}</Text>

              <Pressable
                style={[styles.primaryBtn, (busy || digits.length !== 12) && styles.primaryBtnDisabled]}
                onPress={handleSendOtp}
                disabled={busy || digits.length !== 12}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>{t('ekyc_send_otp')}</Text>
                    <ChevronRight size={18} color={colors.white} strokeWidth={2.4} />
                  </>
                )}
              </Pressable>
            </>
          )}

          {/* ---- step 2: OTP ---- */}
          {step === 'otp' && (
            <>
              <Text style={styles.label}>{t('ekyc_otp_label')}</Text>
              <Text style={styles.sentTo}>{t('ekyc_otp_sent', { last4: digits.slice(-4) })}</Text>
              <TextInput
                style={[styles.input, styles.otpInput]}
                value={otp}
                onChangeText={(v) => {
                  setOtp(v.replace(/\D/g, '').slice(0, 6));
                  setError('');
                }}
                placeholder="······"
                placeholderTextColor={colors.gray400}
                keyboardType="number-pad"
                maxLength={6}
                accessibilityLabel={t('ekyc_otp_label')}
              />
              <Text style={styles.hint}>{t('ekyc_otp_hint', { otp: DEMO_OTP })}</Text>

              <Pressable
                style={[styles.primaryBtn, (busy || otpDigits.length !== 6) && styles.primaryBtnDisabled]}
                onPress={handleVerify}
                disabled={busy || otpDigits.length !== 6}
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <>
                    <ShieldCheck size={18} color={colors.white} strokeWidth={2.4} />
                    <Text style={styles.primaryBtnText}>{t('ekyc_verify')}</Text>
                  </>
                )}
              </Pressable>

              <Pressable onPress={() => setStep('aadhaar')} style={styles.backLink}>
                <Text style={styles.backLinkText}>{t('ekyc_change_number')}</Text>
              </Pressable>
            </>
          )}

          {/* ---- step 3: verified ---- */}
          {step === 'done' && (
            <View style={styles.doneWrap}>
              <View style={styles.doneIcon}>
                <CheckCircle size={40} color={colors.success700} strokeWidth={2.2} />
              </View>
              <Text style={styles.doneTitle}>{t('ekyc_verified_title')}</Text>
              <Text style={styles.doneSub}>{t('ekyc_verified_sub')}</Text>

              <View style={styles.resultCard}>
                <ResultRow label={t('ekyc_result_aadhaar')} value={`XXXX XXXX ${digits.slice(-4)}`} />
                {fullName ? <ResultRow label={t('ekyc_result_name')} value={fullName} /> : null}
                {occupation ? <ResultRow label={t('ekyc_result_occupation')} value={occupation} /> : null}
                <ResultRow label={t('ekyc_result_status')} value={t('ekyc_result_verified')} accent />
              </View>

              <Text style={styles.doneNote}>{t('ekyc_no_review_needed')}</Text>

              <Pressable style={styles.primaryBtn} onPress={close}>
                <Text style={styles.primaryBtnText}>{t('ekyc_continue')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ResultRow({ label, value, accent }) {
  return (
    <View style={styles.resultRow}>
      <Text style={styles.resultLabel}>{label}</Text>
      <Text style={[styles.resultValue, accent && styles.resultValueAccent]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radii.radius2xl,
    borderTopRightRadius: radii.radius2xl,
    padding: spacing.space5,
    paddingBottom: spacing.space6,
    gap: spacing.space3,
    ...shadows.shadowXl,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
  },
  headIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.radiusFull,
    backgroundColor: colors.primary100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSizes.fsLg,
    fontFamily: fontFamilies.interBold,
    fontWeight: fontWeights.fwBold,
    color: colors.gray900,
  },
  subtitle: {
    fontSize: fontSizes.fsXs,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
    marginTop: 1,
  },

  demoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.space2,
    backgroundColor: colors.accent50,
    borderWidth: 1,
    borderColor: colors.accent100,
    borderRadius: radii.radiusMd,
    padding: spacing.space3,
  },
  demoBannerText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: fontFamilies.interMedium,
    color: colors.accent700,
  },

  errorBox: {
    backgroundColor: colors.danger50,
    borderWidth: 1,
    borderColor: colors.danger100,
    borderRadius: radii.radiusMd,
    padding: spacing.space3,
  },
  errorText: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interMedium,
    color: colors.danger700,
  },

  label: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    color: colors.gray700,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radii.radiusMd,
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space3,
    fontSize: fontSizes.fsBase,
    fontFamily: fontFamilies.interMedium,
    color: colors.gray900,
    backgroundColor: colors.white,
    letterSpacing: 1.5,
  },
  otpInput: {
    letterSpacing: 8,
    textAlign: 'center',
    fontSize: fontSizes.fsXl,
  },
  hint: {
    fontSize: fontSizes.fsXs,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
  },
  sentTo: {
    fontSize: fontSizes.fsXs,
    fontFamily: fontFamilies.interMedium,
    color: colors.primary700,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.space2,
    backgroundColor: colors.primary700,
    borderRadius: radii.radiusLg,
    paddingVertical: spacing.space4,
    marginTop: spacing.space2,
  },
  primaryBtnDisabled: {
    backgroundColor: colors.gray300,
  },
  primaryBtnText: {
    fontSize: fontSizes.fsBase,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    color: colors.white,
  },
  backLink: {
    alignSelf: 'center',
    paddingVertical: spacing.space2,
  },
  backLinkText: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interMedium,
    color: colors.primary600,
  },

  doneWrap: {
    alignItems: 'center',
    gap: spacing.space2,
  },
  doneIcon: {
    width: 68,
    height: 68,
    borderRadius: radii.radiusFull,
    backgroundColor: colors.success50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.space2,
  },
  doneTitle: {
    fontSize: fontSizes.fsLg,
    fontFamily: fontFamilies.interBold,
    fontWeight: fontWeights.fwBold,
    color: colors.gray900,
  },
  doneSub: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray600,
    textAlign: 'center',
  },
  resultCard: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radii.radiusLg,
    padding: spacing.space4,
    gap: spacing.space2,
    marginTop: spacing.space2,
    backgroundColor: '#fafafa',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.space3,
  },
  resultLabel: {
    fontSize: fontSizes.fsXs,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
  },
  resultValue: {
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    color: colors.gray900,
  },
  resultValueAccent: {
    color: colors.success700,
  },
  doneNote: {
    fontSize: fontSizes.fsXs,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray500,
    textAlign: 'center',
    marginTop: spacing.space1,
  },
});
