import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchImageLibrary } from 'react-native-image-picker';
import { Eye, EyeOff, User, Wrench, Upload, CheckCircle } from 'lucide-react-native';
import { useAuth } from '@context/AuthContext';
import { useLanguage } from '@context/LanguageContext';
import { BrandLogo } from '@components/app';
import LanguageToggle from '@components/ui/LanguageToggle';
import MultiSelectField from '@components/ui/MultiSelectField';
import { SKILL_OPTIONS, skillName, saveWorkerRegistration } from '@data/workerRegistration';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * RegisterScreen — ported from web pages/auth/RegisterPage.jsx + AuthPages.css.
 *
 * Behaviour preserved exactly:
 *  - Default role from route param { role } (web read location.state.role from the <Link state>).
 *  - Role toggle (customer/worker), full name/phone/email/city/state/password/confirm fields.
 *  - Validation: passwords match, min 6 chars, and for workers: must EITHER upload a cert OR
 *    opt into free training (the exact conditional from web).
 *  - register() call passes skills (comma-separated string) + wantsTraining boolean unchanged.
 *  - Success path: if needsEmailConfirm, show the "check your email" success screen; otherwise
 *    rely on RootNavigator to switch to the correct portal tree (structural nav, like Login).
 *  - Password show/hide, "Already registered? Sign In" link back to Login.
 *
 * CERTIFICATE UPLOAD (Phase 13):
 *  Web used a hidden <input type="file"> whose file was kept in state and never sent anywhere.
 *  Here the "Upload Certificate" button opens the native image picker
 *  (react-native-image-picker, already used for the AI photo diagnosis) and records the picked
 *  file's name so the worker validation branch (must have a cert OR opt into training) behaves
 *  correctly. Like web, the file isn't uploaded to a backend — there's no cert-storage endpoint
 *  in the mock data layer — but a real file is now genuinely selected.
 *
 * VISUAL COMPROMISES: same as LoginScreen (dark bg flattened, orbs dropped, gradient submit →
 * solid, entry animations deferred). The 480px mobile media query (single-column field rows)
 * is baked in — all field rows stack vertically, matching the phone branch.
 */

/**
 * Plain-language sign-up failures.
 *
 * Same reasoning as friendlyAuthError in LoginScreen: Supabase's messages are written for
 * developers. The signup-specific case worth naming is an email that is already registered, because
 * the fix ("sign in instead") is different from every other failure.
 */
function friendlySignupError(rawError, t) {
  const msg = String(rawError || '').toLowerCase();

  if (
    msg.includes('already registered') ||
    msg.includes('already exists') ||
    msg.includes('user already')
  ) {
    return t('signup_email_taken');
  }
  if (msg.includes('password')) {
    return t('password_min');
  }
  if (msg.includes('invalid') && msg.includes('email')) {
    return t('signup_email_invalid');
  }
  if (
    msg.includes('network') ||
    msg.includes('fetch') ||
    msg.includes('timeout') ||
    msg.includes('not configured')
  ) {
    return t('login_no_connection');
  }
  return t('signup_failed_generic');
}

export default function RegisterScreen({ navigation, route }) {
  // `submitting`, not `loading`: `loading` swaps the navigator to the splash screen, which would
  // unmount this form mid-submit and discard everything the user typed.
  const { register, submitting } = useAuth();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const defaultRole = route?.params?.role || 'customer';

  const [role, setRole] = useState(defaultRole);
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '', confirmPw: '', city: '', state: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Worker-specific. `skills` holds SERVICE IDS chosen from the dropdown (was a free-text
  // comma-separated string) so they line up exactly with the categories customers book from.
  const [skills, setSkills] = useState([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [certName, setCertName] = useState(null);
  const [hasCert, setHasCert] = useState(false);
  const [wantsTraining, setWantsTraining] = useState(false);

  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    setError('');
    if (form.password !== form.confirmPw) {
      setError(t('passwords_no_match'));
      return;
    }
    if (form.password.length < 6) {
      setError(t('password_min'));
      return;
    }
    // A worker with no skill selected could never be shown a job, so require at least one.
    if (role === 'worker' && skills.length === 0) {
      setError(t('select_skill_required'));
      return;
    }
    if (role === 'worker' && !hasCert && !wantsTraining) {
      setError(t('cert_or_training'));
      return;
    }

    const result = await register({
      email: form.email,
      password: form.password,
      role,
      fullName: form.fullName,
      phone: form.phone,
      city: form.city,
      state: form.state,
      // Still a comma-separated string of display names — the Supabase trigger that splits this
      // into text[] is untouched. The dropdown only changed HOW the list is chosen.
      skills: skills.map(skillName).join(', '),
      wantsTraining, // boolean; trigger sets worker_profiles.training_requested
    });

    if (!result.success) {
      setError(friendlySignupError(result.error, t));
      return;
    }

    // Persist the parts Supabase has no column for (certificate presence, training progress) and
    // the skill IDs used for job-category filtering. Keyed by email because there may be no user
    // id yet when email confirmation is pending. See src/data/workerRegistration.js.
    if (role === 'worker') {
      saveWorkerRegistration(form.email, { skills, hasCertificate: hasCert, certName, wantsTraining });
    }
    if (result.needsEmailConfirm) {
      setSuccess(true);
    }
    // else: RootNavigator switches to the worker/customer tree on the role change.
  };

  const handlePickCert = async () => {
    try {
      const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.7 });
      if (result?.didCancel) return;
      const asset = result?.assets?.[0];
      if (asset?.uri) {
        setCertName(asset.fileName || 'certificate.jpg');
        setHasCert(true);
      }
    } catch {
      // picker unavailable — leave cert unset; the worker can still opt into training instead
    }
  };

  if (success) {
    return (
      <ScrollView
        style={styles.page}
        contentContainerStyle={[styles.pageContent, { paddingTop: insets.top + spacing.space6 }]}
      >
        <View style={[styles.card, styles.successCard]}>
          <Text style={styles.successEmoji}>📧</Text>
          <Text style={styles.successTitle}>{t('almost_there')}</Text>
          <Text style={styles.successBody}>{t('confirm_email_sent', { email: form.email })}</Text>
          <Pressable style={styles.submit} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.submitText}>{t('back_to_login')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.pageContent, { paddingTop: insets.top + spacing.space6, paddingBottom: insets.bottom + spacing.space6 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <View style={styles.langBar}>
          <LanguageToggle size="sm" />
        </View>
        <View style={styles.brand}>
          {/* EXACT existing app icon (native ic_launcher) with bundled @assets/logo.png fallback,
              replacing the previous text placeholder so the real Sahakar Seva logo is shown. */}
          <View style={styles.logoBox}>
            <BrandLogo style={styles.logo} accessibilityLabel="Sahakar Seva logo" />
          </View>
          <View style={styles.brandTextWrap}>
            <Text style={styles.title}>{t('brand_name')}</Text>
            <Text style={styles.subtitle}>{t('create_account')}</Text>
          </View>
        </View>

        {/* Role toggle */}
        <View style={styles.toggleWrap}>
          <Pressable style={[styles.toggle, role === 'customer' && styles.toggleActive]} onPress={() => setRole('customer')}>
            <User size={16} color={role === 'customer' ? colors.primary700 : colors.gray500} />
            <Text style={[styles.toggleText, role === 'customer' && styles.toggleTextActive]}>{t('customer')}</Text>
          </Pressable>
          <Pressable style={[styles.toggle, role === 'worker' && styles.toggleActive]} onPress={() => setRole('worker')}>
            <Wrench size={16} color={role === 'worker' ? colors.primary700 : colors.gray500} />
            <Text style={[styles.toggleText, role === 'worker' && styles.toggleTextActive]}>{t('worker')}</Text>
          </Pressable>
        </View>

        <View style={styles.form}>
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Field label={t('full_name')} value={form.fullName} onChangeText={set('fullName')} placeholder={t('your_name')} />
          <Field label={t('phone_number')} value={form.phone} onChangeText={set('phone')} placeholder="+91 98765 43210" keyboardType="phone-pad" />
          <Field label={t('email_address')} value={form.email} onChangeText={set('email')} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
          <Field label={t('city')} value={form.city} onChangeText={set('city')} placeholder={t('your_city')} />
          <Field label={t('state')} value={form.state} onChangeText={set('state')} placeholder={t('state')} />

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t('password')}</Text>
            <View style={styles.pwWrap}>
              <TextInput
                style={[styles.input, styles.pwInput]}
                value={form.password}
                onChangeText={set('password')}
                placeholder="••••••••"
                placeholderTextColor={colors.gray400}
                secureTextEntry={!showPw}
              />
              <Pressable style={styles.pwToggle} onPress={() => setShowPw(!showPw)}>
                {showPw ? <EyeOff size={16} color={colors.gray400} /> : <Eye size={16} color={colors.gray400} />}
              </Pressable>
            </View>
          </View>

          <Field
            label={t('confirm_password')}
            value={form.confirmPw}
            onChangeText={set('confirmPw')}
            placeholder="••••••••"
            secureTextEntry
          />

          {role === 'worker' && (
            <View style={styles.workerSection}>
              <Text style={styles.workerTitle}>{t('worker_reg_details')}</Text>

              {/* Skills are picked from the portal's own service catalogue, so a worker can only
                  hold a skill there are actually bookings for. Drives job-feed filtering. */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t('skills_label')}</Text>
                <MultiSelectField
                  open={skillsOpen}
                  onOpen={() => setSkillsOpen(true)}
                  onClose={() => setSkillsOpen(false)}
                  value={skills}
                  onChange={setSkills}
                  options={SKILL_OPTIONS}
                  placeholder={t('skills_placeholder')}
                  title={t('select_skills')}
                  doneLabel={t('done')}
                  emptyLabel={t('select_skill_required')}
                />
                <Text style={styles.fieldHint}>{t('skills_hint')}</Text>
              </View>

              <View>
                <Text style={styles.certLabel}>
                  {t('experience_cert')} <Text style={styles.required}>{t('required')}</Text>
                </Text>
                <Pressable style={[styles.uploadBtn, certName && styles.uploadBtnDone]} onPress={handlePickCert}>
                  {certName ? (
                    <>
                      <CheckCircle size={16} color={colors.success700} />
                      <Text style={styles.uploadTextDone}>{certName}</Text>
                    </>
                  ) : (
                    <>
                      <Upload size={16} color={colors.gray600} />
                      <Text style={styles.uploadText}>{t('upload_cert')}</Text>
                    </>
                  )}
                </Pressable>
                {/* An uploaded certificate goes to the cooperative admin for review — it does not
                    make the worker job-ready on its own. Setting that expectation here avoids the
                    worker signing up and wondering why they cannot accept anything yet. */}
                {certName ? <Text style={styles.certReviewNote}>{t('cert_goes_for_review')}</Text> : null}

                <View style={styles.certOr}>
                  <View style={styles.certOrLine} />
                  <Text style={styles.certOrText}>{t('or')}</Text>
                  <View style={styles.certOrLine} />
                </View>

                <Pressable
                  style={[styles.trainingCheck, wantsTraining && styles.trainingCheckOn]}
                  onPress={() => setWantsTraining(!wantsTraining)}
                >
                  <View style={[styles.checkbox, wantsTraining && styles.checkboxOn]}>
                    {wantsTraining && <CheckCircle size={14} color={colors.white} />}
                  </View>
                  <Text style={styles.trainingText}>
                    {t('enroll_in')} <Text style={styles.trainingStrong}>{t('free_offline_training')}</Text> — {t('freshers_note')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )}

          <Pressable style={[styles.submit, submitting && styles.submitDisabled]} onPress={handleSubmit} disabled={submitting}>
            {submitting ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.submitText}>{t('register_as', { role: role === 'customer' ? t('customer') : t('worker') })}</Text>
            )}
          </Pressable>

          <Text style={styles.switch}>
            {t('already_registered')}{' '}
            <Text style={styles.switchLink} onPress={() => navigation.navigate('Login')}>
              {t('sign_in')} →
            </Text>
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.gray400} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#1e1b4b',
  },
  pageContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.space4,
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: radii.radius2xl,
    padding: spacing.space6,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    ...shadows.shadowXl,
  },
  langBar: {
    alignSelf: 'flex-end',
    marginBottom: spacing.space3,
  },
  successCard: {
    alignItems: 'center',
    padding: spacing.space10,
  },
  successEmoji: {
    fontSize: 48,
    marginBottom: spacing.space4,
  },
  successTitle: {
    fontSize: fontSizes.fs2xl,
    fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold,
    color: colors.primary700,
  },
  successBody: {
    fontSize: fontSizes.fsBase,
    color: colors.gray600,
    fontFamily: fontFamilies.interRegular,
    textAlign: 'center',
    marginTop: spacing.space2,
    lineHeight: fontSizes.fsBase * 1.5,
  },
  successStrong: {
    fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    marginBottom: spacing.space5,
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...shadows.shadowMd,
    shadowColor: colors.primary700,
  },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 14,
  },
  brandTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: fontSizes.fs2xl,
    fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.notoDevanagariBold,
    color: colors.gray900,
  },
  subtitle: {
    fontSize: fontSizes.fsSm,
    color: colors.gray500,
    fontFamily: fontFamilies.interRegular,
  },
  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: colors.gray100,
    borderRadius: radii.radiusLg,
    padding: 4,
    marginBottom: spacing.space4,
  },
  toggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.space2,
    paddingVertical: spacing.space2,
    paddingHorizontal: spacing.space3,
    borderRadius: radii.radiusMd,
  },
  toggleActive: {
    backgroundColor: colors.white,
    ...shadows.shadowSm,
  },
  toggleText: {
    fontSize: fontSizes.fsSm,
    fontWeight: fontWeights.fwMedium,
    fontFamily: fontFamilies.interMedium,
    color: colors.gray500,
  },
  toggleTextActive: {
    color: colors.primary700,
  },
  form: {
    gap: spacing.space4,
  },
  errorBox: {
    backgroundColor: colors.danger50,
    borderWidth: 1,
    borderColor: colors.danger200,
    borderRadius: radii.radiusMd,
    padding: spacing.space3,
  },
  errorText: {
    color: colors.danger700,
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interRegular,
  },
  field: {
    gap: spacing.space1,
  },
  fieldLabel: {
    fontSize: fontSizes.fsSm,
    fontWeight: fontWeights.fwMedium,
    fontFamily: fontFamilies.interMedium,
    color: colors.gray700,
  },
  fieldHint: {
    fontSize: fontSizes.fsXs,
    color: colors.gray500,
    fontFamily: fontFamilies.interRegular,
    marginTop: 2,
  },
  certReviewNote: {
    fontSize: fontSizes.fsXs,
    color: colors.warning800,
    fontFamily: fontFamilies.interMedium,
    marginTop: spacing.space2,
    lineHeight: 16,
  },
  input: {
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
    borderWidth: 1.5,
    borderColor: colors.gray200,
    borderRadius: radii.radiusMd,
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray900,
    backgroundColor: colors.gray50,
  },
  pwWrap: {
    position: 'relative',
    justifyContent: 'center',
  },
  pwInput: {
    paddingRight: 44,
  },
  pwToggle: {
    position: 'absolute',
    right: spacing.space3,
    height: '100%',
    justifyContent: 'center',
  },
  workerSection: {
    backgroundColor: colors.accent50,
    borderWidth: 1,
    borderColor: colors.accent200,
    borderRadius: radii.radiusLg,
    padding: spacing.space4,
    gap: spacing.space3,
  },
  workerTitle: {
    fontSize: fontSizes.fsSm,
    fontWeight: fontWeights.fwSemibold,
    fontFamily: fontFamilies.interSemiBold,
    color: colors.warning800,
  },
  certLabel: {
    fontSize: fontSizes.fsSm,
    fontWeight: fontWeights.fwMedium,
    fontFamily: fontFamilies.interMedium,
    color: colors.gray700,
    marginBottom: spacing.space2,
  },
  required: {
    fontSize: 10,
    color: colors.danger500,
    fontFamily: fontFamilies.interRegular,
  },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
    borderWidth: 2,
    borderColor: colors.gray300,
    borderStyle: 'dashed',
    borderRadius: radii.radiusMd,
  },
  uploadBtnDone: {
    borderColor: colors.success500,
    borderStyle: 'solid',
    backgroundColor: colors.success50,
  },
  uploadText: {
    fontSize: fontSizes.fsSm,
    color: colors.gray600,
    fontFamily: fontFamilies.interRegular,
  },
  uploadTextDone: {
    fontSize: fontSizes.fsSm,
    color: colors.success700,
    fontFamily: fontFamilies.interMedium,
  },
  certOr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    marginVertical: spacing.space3,
  },
  certOrLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.gray200,
  },
  certOrText: {
    fontSize: fontSizes.fsXs,
    color: colors.gray400,
    fontFamily: fontFamilies.interRegular,
  },
  trainingCheck: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.space2,
    padding: spacing.space3,
    borderWidth: 1.5,
    borderColor: colors.gray200,
    borderRadius: radii.radiusMd,
    backgroundColor: colors.white,
  },
  trainingCheckOn: {
    borderColor: colors.primary400,
    backgroundColor: colors.primary50,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.gray300,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: {
    backgroundColor: colors.primary600,
    borderColor: colors.primary600,
  },
  trainingText: {
    flex: 1,
    fontSize: fontSizes.fsSm,
    color: colors.gray700,
    fontFamily: fontFamilies.interRegular,
  },
  trainingStrong: {
    fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold,
  },
  submit: {
    width: '100%',
    paddingVertical: spacing.space4,
    backgroundColor: colors.primary700,
    borderRadius: radii.radiusMd,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.space2,
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: colors.white,
    fontSize: fontSizes.fsBase,
    fontWeight: fontWeights.fwSemibold,
    fontFamily: fontFamilies.interSemiBold,
  },
  switch: {
    fontSize: fontSizes.fsSm,
    color: colors.gray500,
    fontFamily: fontFamilies.interRegular,
    textAlign: 'center',
  },
  switchLink: {
    color: colors.primary600,
    fontWeight: fontWeights.fwSemibold,
    fontFamily: fontFamilies.interSemiBold,
  },
});
