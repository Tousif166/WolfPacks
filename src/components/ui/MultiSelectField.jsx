import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronDown, Check } from 'lucide-react-native';
import Modal from './Modal';
import { serviceIcon } from '../icons';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * MultiSelectField — a dropdown that opens a checkbox list in a modal.
 *
 * Built rather than reached for off-the-shelf because the codebase has no select/picker primitive
 * (components/ui has Input, Badge, Modal… but nothing to choose from a fixed option set), and a
 * plain inline expanding list inside RegisterScreen's ScrollView would fight the scroll view for
 * touches and get clipped near the bottom of the form. Reuses the existing ui/Modal so the
 * scrim, panel and dismiss behaviour match every other modal in the app.
 *
 * Options are `{ id, name, icon? }`. `icon` is the service-catalogue icon NAME (e.g. 'Wrench'),
 * resolved through the shared registry, so this stays consistent with the customer service grid.
 *
 * Controlled: `value` is an array of selected ids, `onChange` receives the next array.
 */
export default function MultiSelectField({
  open,
  onOpen,
  onClose,
  value = [],
  onChange,
  options = [],
  placeholder = 'Select…',
  title = 'Select',
  doneLabel = 'Done',
  emptyLabel,
  invalid = false,
}) {
  const selected = options.filter((o) => value.includes(o.id));
  const summary = selected.length ? selected.map((o) => o.name).join(', ') : placeholder;

  const toggle = (id) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <>
      <Pressable
        style={[styles.trigger, invalid && styles.triggerInvalid]}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={emptyLabel}
      >
        <Text style={[styles.triggerText, !selected.length && styles.triggerPlaceholder]} numberOfLines={1}>
          {summary}
        </Text>
        <ChevronDown size={18} color={colors.gray400} strokeWidth={2.2} />
      </Pressable>

      {/* Selected items echoed as chips so a long multi-selection stays readable when the
          single-line trigger truncates it. */}
      {selected.length > 1 && (
        <View style={styles.chipRow}>
          {selected.map((o) => (
            <View key={o.id} style={styles.chip}>
              <Text style={styles.chipText}>{o.name}</Text>
            </View>
          ))}
        </View>
      )}

      <Modal isOpen={open} onClose={onClose} title={title} size="sm">
        <View style={styles.list}>
          {options.map((o) => {
            const Icon = serviceIcon(o.icon);
            const on = value.includes(o.id);
            return (
              <Pressable
                key={o.id}
                style={[styles.row, on && styles.rowOn]}
                onPress={() => toggle(o.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={o.name}
              >
                <View style={[styles.rowIcon, on && styles.rowIconOn]}>
                  <Icon size={16} color={on ? colors.primary700 : colors.gray500} strokeWidth={2.2} />
                </View>
                <Text style={[styles.rowText, on && styles.rowTextOn]}>{o.name}</Text>
                <View style={[styles.box, on && styles.boxOn]}>{on && <Check size={13} color={colors.white} strokeWidth={3} />}</View>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.done} onPress={onClose}>
          <Text style={styles.doneText}>{doneLabel}</Text>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
    borderWidth: 1.5,
    borderColor: colors.gray200,
    borderRadius: radii.radiusMd,
    backgroundColor: colors.gray50,
  },
  triggerInvalid: { borderColor: colors.danger300 },
  triggerText: {
    flex: 1,
    fontSize: fontSizes.fsSm,
    fontFamily: fontFamilies.interRegular,
    color: colors.gray900,
  },
  triggerPlaceholder: { color: colors.gray400 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space2, marginTop: spacing.space2 },
  chip: {
    paddingVertical: 3,
    paddingHorizontal: spacing.space2,
    borderRadius: radii.radiusFull,
    backgroundColor: colors.primary50,
    borderWidth: 1,
    borderColor: colors.primary100,
  },
  chipText: {
    fontSize: fontSizes.fsXs,
    color: colors.primary700,
    fontFamily: fontFamilies.interMedium,
    fontWeight: fontWeights.fwMedium,
  },

  list: { gap: spacing.space2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space3,
    borderWidth: 1.5,
    borderColor: colors.gray200,
    borderRadius: radii.radiusMd,
    backgroundColor: colors.surfaceWhite,
  },
  rowOn: { borderColor: colors.primary400, backgroundColor: colors.primary50 },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.radiusFull,
    backgroundColor: colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconOn: { backgroundColor: colors.primary100 },
  rowText: {
    flex: 1,
    fontSize: fontSizes.fsSm,
    color: colors.gray800,
    fontFamily: fontFamilies.interMedium,
    fontWeight: fontWeights.fwMedium,
  },
  rowTextOn: { color: colors.primary800 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.gray300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.primary600, borderColor: colors.primary600 },

  done: {
    marginTop: spacing.space4,
    paddingVertical: spacing.space3,
    borderRadius: radii.radiusMd,
    backgroundColor: colors.primary700,
    alignItems: 'center',
  },
  doneText: {
    color: colors.white,
    fontSize: fontSizes.fsSm,
    fontWeight: fontWeights.fwSemibold,
    fontFamily: fontFamilies.interSemiBold,
  },
});
