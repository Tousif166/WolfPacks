import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '@context/AuthContext';
import { useLanguage } from '@context/LanguageContext';
import Button from '@components/ui/Button';
import { colors, spacing, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * Access-denied screen — ports the "Admin access required" branch of the web ProtectedRoute.jsx.
 *
 * Web behaviour: when a real (non-demo) authenticated user whose profile.role !== the required
 * role reached /admin, ProtectedRoute rendered a full-screen denial with a "Back to Login" link
 * (an <a href="/auth">). The migration plan says to keep this as a DEDICATED SCREEN rather than
 * an inline redirect.
 *
 * Here it's reachable only via explicit navigation to it (the root navigator never mounts a
 * portal a user isn't entitled to, so a customer simply never gets Admin tabs — the silent
 * "redirect to your own portal" case from web is handled structurally by conditional trees).
 * This screen therefore exists for the specific admin-mismatch UX and offers a logout action in
 * place of the web "Back to Login" link.
 */
export default function AccessDeniedScreen() {
  const { role, logout } = useAuth();
  const { t } = useLanguage();

  return (
    <View style={styles.container}>
      <Text style={styles.lock}>🔒</Text>
      <Text style={styles.title}>{t('admin_access_required')}</Text>
      <Text style={styles.body}>{t('access_denied_body', { role: role || t('role_unknown') })}</Text>
      <Button variant="primary" onPress={logout} style={styles.button}>
        {t('back_to_login')}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray50,
    padding: spacing.space8,
  },
  lock: {
    fontSize: 40,
    marginBottom: spacing.space4,
  },
  title: {
    fontSize: fontSizes.fs2xl,
    fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold,
    color: colors.danger600,
    marginBottom: spacing.space4,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSizes.fsBase,
    color: colors.gray500,
    fontFamily: fontFamilies.interRegular,
    textAlign: 'center',
    maxWidth: 380,
    lineHeight: fontSizes.fsBase * 1.5,
  },
  button: {
    marginTop: spacing.space6,
  },
});
