import { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Globe } from 'lucide-react-native';
import { useLanguage } from '@context/LanguageContext';
import { LANGUAGES } from '@data/translations';
import LanguageToggle from './LanguageToggle';
import Modal from './Modal';
import Button from './Button';
import { colors, spacing, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * InitialLanguageModal — shown once on first launch when LanguageContext.language is null.
 *
 * REVAMP: this used to have its OWN grid of language buttons (one of the four parallel selectors),
 * and its subtitle/confirm button hardcoded two languages in one string
 * ("Please select... / कृपया अपनी..."). Both are gone:
 *   - the picker is now the SAME canonical <LanguageToggle> used in the header and profile, so
 *     first-launch selection looks identical to changing language later;
 *   - the heading is shown in the currently-highlighted language's own script (using that
 *     language's welcome string + its bundled font), and the subtitle/button use t() so exactly
 *     one language shows at a time.
 *
 * The context starts as null (nothing chosen), so t() falls back to English until the user picks.
 * To keep the picker meaningful before a choice is committed, we track a local `preview` language
 * for the heading font/text only; tapping a segment sets the real app language immediately (which
 * is fine — it re-renders live and Continue simply dismisses).
 */
export default function InitialLanguageModal() {
  const { language, resolvedLanguage, setLanguage, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!language) setIsOpen(true);
  }, [language]);

  const handleConfirm = () => {
    // Guarantee a concrete choice is persisted even if the user never tapped a segment.
    if (!language) setLanguage(resolvedLanguage);
    setIsOpen(false);
  };

  if (!isOpen) return null;

  const selected = LANGUAGES.find((l) => l.code === resolvedLanguage) || LANGUAGES[0];
  const headingFont =
    selected.code === 'hi'
      ? fontFamilies.notoDevanagariBold
      : selected.code === 'bn'
      ? fontFamilies.notoBengaliBold
      : fontFamilies.interBold;

  return (
    <Modal isOpen={isOpen} onClose={() => {}} title="" hideClose>
      <View style={styles.container}>
        <Globe size={48} color={colors.primary500} style={styles.icon} />
        <Text style={[styles.welcome, { fontFamily: headingFont }]}>{selected.welcome}</Text>
        <Text style={styles.subtitle}>{t('select_language')}</Text>

        <View style={styles.toggleWrap}>
          <LanguageToggle size="md" />
        </View>

        <Button variant="primary" size="lg" fullWidth onPress={handleConfirm} style={styles.confirm}>
          {t('continue')}
        </Button>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.space4,
  },
  icon: {
    marginBottom: spacing.space6,
  },
  welcome: {
    fontSize: fontSizes.fsXl,
    fontWeight: fontWeights.fwSemibold,
    color: colors.gray900,
    textAlign: 'center',
    marginBottom: spacing.space2,
  },
  subtitle: {
    fontSize: fontSizes.fsSm,
    color: colors.gray500,
    fontFamily: fontFamilies.interRegular,
    textAlign: 'center',
    marginBottom: spacing.space6,
  },
  toggleWrap: {
    width: '100%',
    marginTop: spacing.space2,
  },
  confirm: {
    marginTop: spacing.space6,
  },
});
