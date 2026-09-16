import { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react-native';
import Modal from './Modal';
import { useLanguage } from '@context/LanguageContext';
import { colors, spacing, radii, fontSizes, fontWeights, fontFamilies } from '@theme';

/**
 * DatePickerField — a tappable field that opens a month-grid calendar.
 *
 * Built rather than adding a native date-picker dependency: @react-native-community/datetimepicker
 * needs a Gradle rebuild, and this project has already hit a C++ linking wall from the space in the
 * Windows username. A JS calendar has no native surface, works identically on both platforms, and
 * lets min/max be enforced visually (out-of-range days are rendered dead) rather than only rejected
 * after the fact.
 *
 * ALL DATE MATHS IS LOCAL TIME. `toISOString()` converts to UTC first, which shifts the calendar day
 * backwards for anyone east of Greenwich — in IST (+5:30) every date before 05:30 local would land on
 * the previous day. Same bug already fixed once in src/data/demandHistory.js.
 *
 * Values are ISO `YYYY-MM-DD` strings, which compare correctly with plain string operators, so range
 * checks need no Date objects at all.
 *
 * @param {string}   value        Currently selected date as 'YYYY-MM-DD', or '' when unset.
 * @param {Function} onChange     Receives the newly picked 'YYYY-MM-DD'.
 * @param {string}   [minDate]    Earliest selectable date, inclusive.
 * @param {string}   [maxDate]    Latest selectable date, inclusive.
 * @param {string}   [placeholder] Shown when nothing is selected.
 * @param {string}   [title]      Modal heading.
 */
export default function DatePickerField({
  value,
  onChange,
  minDate = null,
  maxDate = null,
  placeholder = 'Select a date',
  title = 'Select a date',
  invalid = false,
}) {
  const { resolvedLanguage } = useLanguage();
  const [open, setOpen] = useState(false);

  // Which month the grid is showing. Opens on the selected date's month, else the min date's, else
  // today — so a picker constrained to the future does not open on an all-disabled month.
  const [view, setView] = useState(() => monthOf(value || minDate || todayIso()));

  const locale = LOCALES[resolvedLanguage] || LOCALES.en;
  const monthNames = useMemo(() => buildMonthNames(locale), [locale]);
  const weekdayNames = useMemo(() => buildWeekdayNames(locale), [locale]);

  const openPicker = () => {
    // Re-anchor on open, so reopening after the constraints changed lands on a sensible month.
    setView(monthOf(value || minDate || todayIso()));
    setOpen(true);
  };

  const pick = (iso) => {
    onChange(iso);
    setOpen(false);
  };

  const cells = useMemo(() => buildCells(view.year, view.month), [view]);
  const today = todayIso();

  // Month navigation is hidden entirely when it could only reach disabled days.
  const prevMonthLast = lastDayIso(view.year, view.month - 1);
  const nextMonthFirst = firstDayIso(view.year, view.month + 1);
  const canGoPrev = !minDate || prevMonthLast >= minDate;
  const canGoNext = !maxDate || nextMonthFirst <= maxDate;

  return (
    <>
      <Pressable
        style={[styles.field, invalid && styles.fieldInvalid]}
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={value ? `${title}: ${value}` : placeholder}
      >
        <CalendarDays size={17} color={colors.primary600} strokeWidth={2.2} />
        <Text style={[styles.fieldText, !value && styles.fieldPlaceholder]} numberOfLines={1}>
          {value ? formatLong(value, locale) : placeholder}
        </Text>
      </Pressable>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={title} size="sm">
        {/* Month navigation */}
        <View style={styles.monthRow}>
          <Pressable
            onPress={() => canGoPrev && setView(shiftMonth(view, -1))}
            disabled={!canGoPrev}
            hitSlop={8}
            style={[styles.navBtn, !canGoPrev && styles.navBtnOff]}
            accessibilityLabel="Previous month"
          >
            <ChevronLeft size={20} color={canGoPrev ? colors.primary600 : colors.gray300} />
          </Pressable>
          <Text style={styles.monthLabel}>{monthNames[view.month]} {view.year}</Text>
          <Pressable
            onPress={() => canGoNext && setView(shiftMonth(view, 1))}
            disabled={!canGoNext}
            hitSlop={8}
            style={[styles.navBtn, !canGoNext && styles.navBtnOff]}
            accessibilityLabel="Next month"
          >
            <ChevronRight size={20} color={canGoNext ? colors.primary600 : colors.gray300} />
          </Pressable>
        </View>

        {/* Weekday header */}
        <View style={styles.weekRow}>
          {weekdayNames.map((w, i) => (
            <View key={`${w}-${i}`} style={styles.cell}>
              <Text style={styles.weekText}>{w}</Text>
            </View>
          ))}
        </View>

        {/* Day grid */}
        <View style={styles.grid}>
          {cells.map((day, idx) => {
            if (day == null) return <View key={`blank-${idx}`} style={styles.cell} />;

            const iso = isoFor(view.year, view.month, day);
            const disabled = (minDate && iso < minDate) || (maxDate && iso > maxDate);
            const selected = value === iso;
            const isToday = iso === today;

            return (
              <Pressable
                key={iso}
                style={styles.cell}
                onPress={() => !disabled && pick(iso)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !!disabled }}
                accessibilityLabel={formatLong(iso, locale)}
              >
                <View style={[styles.day, selected && styles.daySelected, !selected && isToday && styles.dayToday]}>
                  <Text
                    style={[
                      styles.dayText,
                      selected && styles.dayTextSelected,
                      disabled && styles.dayTextDisabled,
                      !selected && isToday && styles.dayTextToday,
                    ]}
                  >
                    {day}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Date helpers — all local-time, all ISO 'YYYY-MM-DD' strings         */
/* ------------------------------------------------------------------ */

const LOCALES = { en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN' };

const FALLBACK_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const FALLBACK_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

/** Today as a local-time ISO date. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `days` from today as a local-time ISO date. Negative goes backwards. */
export function isoFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoFor(year, month, day) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/** Handles month overflow/underflow, so month -1 and 12 roll the year correctly. */
function firstDayIso(year, month) {
  const d = new Date(year, month, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(1)}`;
}

function lastDayIso(year, month) {
  const d = new Date(year, month + 1, 0); // day 0 of the next month == last day of this one
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthOf(iso) {
  const [y, m] = String(iso).split('-').map(Number);
  if (!y || !m) {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  }
  return { year: y, month: m - 1 };
}

function shiftMonth({ year, month }, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/** Leading blanks so the 1st lands under its weekday, then each day of the month. */
function buildCells(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let i = 0; i < firstWeekday; i++) out.push(null);
  for (let d = 1; d <= daysInMonth; d++) out.push(d);
  return out;
}

/**
 * Month and weekday names come from Intl so they localise without 19 extra translation keys.
 * Hermes ships Intl on modern RN, but it is guarded: if it is ever unavailable the calendar falls
 * back to English names rather than rendering "undefined" in every header cell.
 */
function buildMonthNames(locale) {
  try {
    return Array.from({ length: 12 }, (_, m) =>
      new Date(2024, m, 1).toLocaleDateString(locale, { month: 'long' }),
    );
  } catch {
    return FALLBACK_MONTHS;
  }
}

function buildWeekdayNames(locale) {
  try {
    // 2024-01-07 was a Sunday, matching getDay() === 0.
    return Array.from({ length: 7 }, (_, i) =>
      new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: 'short' }),
    );
  } catch {
    return FALLBACK_WEEKDAYS;
  }
}

/** Human-readable form of an ISO date for the closed field and accessibility labels. */
export function formatLong(iso, locale = 'en-IN') {
  const d = new Date(`${iso}T00:00:00`); // explicit local midnight, never UTC-parsed
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

const CELL = `${100 / 7}%`;

const styles = StyleSheet.create({
  field: {
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
  fieldInvalid: { borderColor: colors.danger300 },
  fieldText: { flex: 1, fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interRegular, color: colors.gray900 },
  fieldPlaceholder: { color: colors.gray400 },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.space3,
  },
  navBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.radiusMd,
    backgroundColor: colors.primary50,
  },
  navBtnOff: { backgroundColor: colors.gray100 },
  monthLabel: {
    fontSize: fontSizes.fsBase,
    fontFamily: fontFamilies.interBold,
    fontWeight: fontWeights.fwBold,
    color: colors.gray900,
  },

  weekRow: { flexDirection: 'row', marginBottom: spacing.space1 },
  weekText: {
    fontSize: 11,
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: fontWeights.fwSemibold,
    color: colors.gray400,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  day: {
    width: 36,
    height: 36,
    borderRadius: radii.radiusFull,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelected: { backgroundColor: colors.primary600 },
  dayToday: { borderWidth: 1.5, borderColor: colors.primary300 },
  dayText: { fontSize: fontSizes.fsSm, fontFamily: fontFamilies.interMedium, color: colors.gray800 },
  dayTextSelected: { color: colors.white, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  dayTextToday: { color: colors.primary700, fontFamily: fontFamilies.interBold, fontWeight: fontWeights.fwBold },
  dayTextDisabled: { color: colors.gray300 },
});
