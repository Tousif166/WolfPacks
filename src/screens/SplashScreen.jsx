import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLanguage } from '@context/LanguageContext';
import { colors, spacing, fontSizes, fontFamilies } from '@theme';

/**
 * Splash / loading screen — shown while AuthContext.loading is true (session restore in flight).
 * Ports the loading spinner branch of the web ProtectedRoute.jsx ("Loading Sahakar Seva...").
 */
export default function SplashScreen() {
  const { t } = useLanguage();
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.primary600} />
      <Text style={styles.text}>{t('loading_brand')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gray50,
    gap: spacing.space4,
  },
  text: {
    fontSize: fontSizes.fsBase,
    color: colors.gray500,
    fontFamily: fontFamilies.interRegular,
  },
});
