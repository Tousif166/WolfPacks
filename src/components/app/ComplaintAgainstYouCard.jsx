import { View, Text, StyleSheet } from 'react-native';
import { AlertTriangle, Sparkles } from 'lucide-react-native';
import { useLanguage } from '@context/LanguageContext';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * ComplaintAgainstYouCard — shown to whichever party a complaint was filed AGAINST.
 *
 * SHARED between the worker portal (a customer complained) and the customer portal (a worker
 * complained), because the two are the same card with the same AI suggestion. Only the wording of
 * who filed it differs, which is a translation key rather than a second component.
 *
 * WHILE THE SUGGESTION IS STILL GENERATING the card shows the complaint alone with a quiet
 * "preparing advice" line — not a spinner. The complaint is the important content; advice arriving a
 * second later must not make the card look broken or half-loaded. If generation FAILED the section
 * is simply omitted, since an error message has no business sitting inside somebody's dispute.
 */
export default function ComplaintAgainstYouCard({ complaint, filedByLabelKey }) {
  const { t } = useLanguage();

  const suggestion = complaint.aiStatus === 'done' ? complaint.aiSuggestion : null;
  const waiting = complaint.aiStatus === 'idle' || complaint.aiStatus === 'pending';

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <AlertTriangle size={15} color={colors.danger700} strokeWidth={2.4} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>{t('complaint_against_you')}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {t(filedByLabelKey)} · {complaint.serviceName} · #{complaint.bookingId || complaint.id}
          </Text>
        </View>
      </View>

      <Text style={styles.subject}>{complaint.subject}</Text>
      {complaint.description ? <Text style={styles.desc}>{complaint.description}</Text> : null}

      {suggestion ? (
        <View style={styles.aiBox}>
          <View style={styles.aiHead}>
            <Sparkles size={13} color={colors.primary700} strokeWidth={2.4} />
            <Text style={styles.aiLabel}>{t('ai_suggestion')}</Text>
          </View>
          <Text style={styles.aiText}>{suggestion}</Text>
        </View>
      ) : waiting ? (
        <Text style={styles.aiPending}>{t('ai_suggestion_pending')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.danger50,
    borderRadius: radii.radiusXl,
    padding: spacing.space4,
    borderWidth: 1.5,
    borderColor: colors.danger200,
    marginBottom: spacing.space3,
    gap: spacing.space2,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radii.radiusFull,
    backgroundColor: colors.danger100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSizes.fsSm,
    fontWeight: fontWeights.fwBold,
    fontFamily: fontFamilies.interBold,
    color: colors.danger700,
  },
  meta: { fontSize: fontSizes.fsXs, color: colors.gray500, fontFamily: fontFamilies.interRegular },
  subject: {
    fontSize: fontSizes.fsSm,
    color: colors.gray900,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
  },
  desc: { fontSize: fontSizes.fsXs, color: colors.gray600, fontFamily: fontFamilies.interRegular, lineHeight: 17 },
  aiBox: {
    backgroundColor: colors.surfaceWhite,
    borderRadius: radii.radiusMd,
    padding: spacing.space3,
    borderWidth: 1,
    borderColor: colors.primary100,
    gap: 4,
  },
  aiHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.space1 },
  aiLabel: {
    fontSize: 10,
    color: colors.primary700,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  aiText: { fontSize: fontSizes.fsXs, color: colors.gray800, fontFamily: fontFamilies.interRegular, lineHeight: 17 },
  aiPending: {
    fontSize: fontSizes.fsXs,
    color: colors.gray500,
    fontFamily: fontFamilies.interRegular,
    fontStyle: 'italic',
  },
});
