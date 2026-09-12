import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldX, LogOut, Phone } from 'lucide-react-native';
import { useAuth } from '@context/AuthContext';
import { useLanguage } from '@context/LanguageContext';
import { REJECT_FAKE, useWorkerRegistration } from '@data/workerRegistration';
import { colors, spacing, radii, shadows, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * WorkerBannedScreen — the ENTIRE worker portal for a banned account.
 *
 * WorkerTabs renders this instead of the tab navigator when the account is banned, so there is no
 * dashboard, job feed, profile, leave or training to reach — not merely disabled controls, but no
 * navigation to them at all. Only two actions remain: read why, and log out.
 *
 * The reason is spelled out rather than left as a generic "access denied", because a worker who
 * does not know what they are accused of cannot contest it. A helpline route is offered for exactly
 * that reason — a ban decided by one admin should not be a dead end.
 */
export default function WorkerBannedScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();
  const { logout, profile, user } = useAuth();
  // The ban and its reason live in the registration store (keyed by email), not on the auth
  // profile — Supabase has no column for either. See src/data/workerRegistration.js.
  const registration = useWorkerRegistration(user?.email);

  return (
    <View style={[styles.page, { paddingTop: insets.top + spacing.space8, paddingBottom: insets.bottom + spacing.space6 }]}>
      <View style={styles.card}>
        <View style={styles.icon}>
          <ShieldX size={40} color={colors.danger600} strokeWidth={2.1} />
        </View>

        <Text style={styles.title}>{t('account_banned_title')}</Text>
        {profile?.full_name ? <Text style={styles.who}>{profile.full_name}</Text> : null}

        <View style={styles.reasonBox}>
          <Text style={styles.reasonLabel}>{t('ban_reason_label')}</Text>
          {/* Only one ban route exists today (a certificate found to be fraudulent); the fallback
              keeps this readable if another is ever added. */}
          <Text style={styles.reasonText}>
            {t(registration?.banReason === REJECT_FAKE ? 'ban_reason_fake' : 'ban_reason_generic')}
          </Text>
        </View>

        <Text style={styles.body}>{t('account_banned_body')}</Text>

        <View style={styles.helpRow}>
          <Phone size={14} color={colors.gray600} strokeWidth={2.2} />
          <Text style={styles.helpText}>{t('account_banned_appeal')}</Text>
        </View>
      </View>

      <Pressable style={styles.logoutBtn} onPress={logout} accessibilityRole="button">
        <LogOut size={18} color={colors.white} strokeWidth={2.3} />
        <Text style={styles.logoutText}>{t('logout')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surfaceCanvas || colors.gray50,
    paddingHorizontal: spacing.space4,
    justifyContent: 'center',
    gap: spacing.space5,
  },
  card: {
    backgroundColor: colors.surfaceWhite,
    borderRadius: radii.radius2xl,
    padding: spacing.space6,
    alignItems: 'center',
    gap: spacing.space3,
    borderWidth: 1.5,
    borderColor: colors.danger200,
    ...shadows.shadowMd,
  },
  icon: {
    width: 76,
    height: 76,
    borderRadius: radii.radiusFull,
    backgroundColor: colors.danger50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSizes.fsXl,
    fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold,
    color: colors.danger700,
    textAlign: 'center',
  },
  who: {
    fontSize: fontSizes.fsSm,
    color: colors.gray600,
    fontFamily: fontFamilies.interMedium,
  },
  reasonBox: {
    width: '100%',
    backgroundColor: colors.danger50,
    borderRadius: radii.radiusLg,
    padding: spacing.space4,
    borderWidth: 1,
    borderColor: colors.danger100,
    gap: 2,
  },
  reasonLabel: {
    fontSize: fontSizes.fsXs,
    color: colors.danger700,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  reasonText: {
    fontSize: fontSizes.fsSm,
    color: colors.gray900,
    fontFamily: fontFamilies.interMedium,
    lineHeight: 20,
  },
  body: {
    fontSize: fontSizes.fsSm,
    color: colors.gray600,
    fontFamily: fontFamilies.interRegular,
    textAlign: 'center',
    lineHeight: 20,
  },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    paddingTop: spacing.space1,
  },
  helpText: {
    flex: 1,
    fontSize: fontSizes.fsXs,
    color: colors.gray600,
    fontFamily: fontFamilies.interRegular,
    lineHeight: 16,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.space2,
    backgroundColor: colors.danger600,
    borderRadius: radii.radiusMd,
    paddingVertical: spacing.space4,
  },
  logoutText: {
    color: colors.white,
    fontSize: fontSizes.fsBase,
    fontWeight: fontWeights.fwSemibold,
    fontFamily: fontFamilies.interSemiBold,
  },
});
