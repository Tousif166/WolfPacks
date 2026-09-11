import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useLanguage } from '@context/LanguageContext';
import { LANGUAGES } from '@data/translations';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * LanguageToggle — the ONE canonical language control for the whole app.
 *
 * Replaces the four parallel selectors that existed before (the dropdown LanguageSwitcher in the
 * header, the chip row in the profile, the EN/HI/BN pills in the chat widget, and a separate list
 * in the initial modal). They looked and behaved differently, which is part of why the language
 * experience felt inconsistent. This is a single segmented control used everywhere, so switching
 * language looks and works the same in every location.
 *
 * All variants toggle BETWEEN the buttons in place (no dropdown, no modal), which is what the
 * revamp asked for: the languages sit next to each other and you tap to switch.
 *
 * Props:
 *   size    — 'sm' (compact, for the header) | 'md' (default, for settings cards)
 *   showLabel (size 'sm' only) — when false, shows the short code (EN/हি/বা) to fit a tight header;
 *             when true, shows the full self-name.
 *
 * Selecting a language calls setLanguage(), which persists to MMKV and re-renders every t()
 * string app-wide.
 */
export default function LanguageToggle({ size = 'md', showLabel = true }) {
  const { resolvedLanguage, setLanguage } = useLanguage();
  const compact = size === 'sm';

  return (
    <View
      style={[styles.group, compact && styles.groupSm]}
      accessibilityRole="radiogroup"
    >
      {LANGUAGES.map((lang) => {
        const active = resolvedLanguage === lang.code;
        const text = compact && !showLabel ? lang.short : lang.label;
        // Each label renders in its own script's font so बा/বা shape correctly.
        const font = active ? scriptFont(lang.code, true) : scriptFont(lang.code, false);
        return (
          <Pressable
            key={lang.code}
            style={[
              styles.segment,
              compact && styles.segmentSm,
              active && styles.segmentActive,
            ]}
            onPress={() => setLanguage(lang.code)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={lang.label}
          >
            <Text
              style={[
                compact ? styles.textSm : styles.text,
                { fontFamily: font },
                active && styles.textActive,
              ]}
              numberOfLines={1}
            >
              {text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Map a language code to the right bundled font. Kept local (not the context's fontFor) because
// each SEGMENT shows its OWN language's script, not the app's current one.
function scriptFont(code, bold) {
  if (code === 'hi') return bold ? fontFamilies.notoDevanagariBold : fontFamilies.notoDevanagariMedium;
  if (code === 'bn') return bold ? fontFamilies.notoBengaliBold : fontFamilies.notoBengaliMedium;
  return bold ? fontFamilies.interSemiBold : fontFamilies.interMedium;
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    backgroundColor: colors.gray100,
    borderRadius: radii.radiusLg,
    padding: 3,
    gap: 3,
  },
  groupSm: {
    borderRadius: radii.radiusMd,
    padding: 2,
    gap: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space2,
    borderRadius: radii.radiusMd,
  },
  segmentSm: {
    flex: 0,
    minWidth: 34,
    paddingVertical: 5,
    paddingHorizontal: spacing.space2,
    borderRadius: radii.radiusSm,
  },
  segmentActive: {
    backgroundColor: colors.primary600,
  },
  text: {
    fontSize: fontSizes.fsSm,
    fontWeight: fontWeights.fwSemibold,
    color: colors.gray700,
  },
  textSm: {
    fontSize: fontSizes.fsXs,
    fontWeight: fontWeights.fwSemibold,
    color: colors.gray600,
  },
  textActive: {
    color: colors.white,
  },
});
