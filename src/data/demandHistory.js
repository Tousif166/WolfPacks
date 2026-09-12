import { mockBookings } from './mockBookings';
import { categories, zones, baseDemand, dayMultipliers, zoneWeights, festivals } from './mockHistoricalDemand';

/**
 * demandHistory — the daily demand series the forecast model is fed.
 *
 * REPLACES `historicalDemand` from mockHistoricalDemand.js, which had three problems:
 *   1. It called Math.random() at module-import time, so every app launch produced a DIFFERENT
 *      history and therefore a different forecast. Nothing was reproducible.
 *   2. It was a fixed 30-day window that never grew.
 *   3. It was purely synthetic — real bookings placed in the app never reached it, so the forecast
 *      could not respond to anything the user actually did.
 *
 * HOW THIS FIXES IT: each day's synthetic baseline is a PURE FUNCTION OF ITS DATE. A hash of the
 * date string seeds a small deterministic PRNG, so 2026-09-11 always yields the same numbers on
 * every device and every launch, while the series still extends itself automatically as days pass.
 *
 * That also means the baseline needs no persistence — it is derived, not stored. The only thing
 * that needs storing is real bookings, and those are already persisted in mockBookings. Real
 * bookings are OVERLAID on top of the baseline for their date, so there is no double counting and
 * no mutation hook to keep in sync.
 *
 * ZONE CAVEAT: bookings carry a free-text `address` and no zone field, so real activity contributes
 * to the category and total figures but NOT to the per-zone split. The zone series stays synthetic
 * until a zone is captured at booking time. Flagged rather than faked.
 */

/** Changing this salt reshuffles the whole synthetic series; keep it fixed to stay reproducible. */
const SEED_SALT = 'sahakar-demand-v1';

/** How many days of history to build. Long enough for the 7-day weighted moving average window. */
export const HISTORY_DAYS = 120;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEATHER_KINDS = ['Clear', 'Clear', 'Clear', 'Rainy', 'Rainy', 'Hot'];

/* eslint-disable no-bitwise --
 * The two functions below are a hash and a PRNG. Bitwise arithmetic on 32-bit words IS the
 * algorithm — FNV-1a and mulberry32 are defined in terms of xor/shift/or, and rewriting them
 * without those operators would change their output. Scoped narrowly and re-enabled straight
 * after. */

/** FNV-1a — small, fast, and stable across engines (no reliance on Hermes internals). */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — 32-bit PRNG, deterministic for a given seed. */
function mulberry32(seed) {
  let a = seed;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* eslint-enable no-bitwise */

/** YYYY-MM-DD in LOCAL time — toISOString() would shift the date across timezones. */
export function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Deterministic weather for a date. Same everywhere, no storage needed. */
export function weatherFor(dateStr) {
  const rnd = mulberry32(hashString(`${SEED_SALT}:weather:${dateStr}`));
  return WEATHER_KINDS[Math.floor(rnd() * WEATHER_KINDS.length)];
}

/**
 * The weather sensitivity of each trade. These are the SAME relationships the hand-written engine
 * used; the Python training run fits its own coefficients for these interactions, and this table
 * remains only to shape the synthetic baseline.
 */
function weatherMultiplier(weather, category) {
  if (weather === 'Rainy') {
    if (category === 'plumbing' || category === 'electrical') return 1.4;
    if (category === 'painting') return 0.4;
    if (category === 'cleaning') return 0.75;
    return 1.0;
  }
  if (weather === 'Hot') {
    if (category === 'ac-repair') return 1.6;
    if (category === 'pest-control') return 1.3;
    if (category === 'painting') return 0.85;
    return 1.0;
  }
  return category === 'painting' || category === 'carpentry' ? 1.1 : 1.0;
}

/**
 * Festival uplift for a trade on a date.
 *
 * RECURS ANNUALLY. The festival table carries one dated instance each (Diwali 2026-10-20, and so
 * on), but these are yearly events, so only the month and day are used and the nearest occurrence
 * in the previous, current or next year is matched. Without this, a multi-year history would contain
 * a single Diwali and the model would have almost no festival examples to learn from.
 *
 * Effect decays with distance and reaches at most 7 days out, floored at 0.3 of full strength —
 * the same shape forecastEngine.getFestivalMultiplier uses.
 */
export function festivalFor(dateStr, category) {
  const target = new Date(`${dateStr}T00:00:00`);
  const year = target.getFullYear();

  let best = null;
  festivals.forEach((f) => {
    if (!f.affectedCategories.includes(category)) return;
    const [, month, day] = f.date.split('-').map(Number);
    // Check adjacent years so effects spanning 1 January are still found.
    [year - 1, year, year + 1].forEach((y) => {
      const occurrence = new Date(y, month - 1, day);
      const diffDays = Math.abs((occurrence - target) / 86400000);
      if (diffDays <= 7 && (best === null || diffDays < best.diffDays)) {
        best = { name: f.name, diffDays, multiplier: f.demandMultiplier };
      }
    });
  });

  if (!best) return { name: null, multiplier: 1 };
  const strength = Math.max(1 - best.diffDays / 10, 0.3);
  return { name: best.name, multiplier: 1 + (best.multiplier - 1) * strength };
}

/**
 * The synthetic baseline for one date — deterministic, derived only from the date itself.
 * Mirrors the generator in ml/synthetic.py so the model is trained on the same shape of
 * data it will later be asked to score.
 */
export function syntheticDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const dayOfWeek = d.getDay();
  const dayMult = dayMultipliers[dayOfWeek] || 1;
  const weather = weatherFor(dateStr);

  const rnd = mulberry32(hashString(`${SEED_SALT}:day:${dateStr}`));

  const cats = {};
  let total = 0;
  let festivalName = null;
  categories.forEach((cat) => {
    const noise = 0.85 + rnd() * 0.3; // ±15% day-to-day noise
    // Festival uplift is deterministic, so applying it here does not disturb the PRNG draw order.
    const fest = festivalFor(dateStr, cat);
    if (fest.name) festivalName = fest.name;
    const value = Math.max(
      0,
      Math.round(baseDemand[cat] * dayMult * weatherMultiplier(weather, cat) * fest.multiplier * noise),
    );
    cats[cat] = value;
    total += value;
  });

  const zoneSplit = {};
  zones.forEach((z) => {
    zoneSplit[z] = Math.max(0, Math.round(total * (zoneWeights[z] || 0) * (0.9 + rnd() * 0.2)));
  });

  return {
    date: dateStr,
    dayOfWeek,
    dayName: DAY_NAMES[dayOfWeek],
    categories: cats,
    zones: zoneSplit,
    total,
    weather,
    festival: festivalName,
    realBookings: 0,
  };
}

/**
 * Real bookings grouped by date then service id. Cancelled bookings are excluded — they represent
 * demand that did not materialise, and counting them would inflate the signal.
 */
function realCountsByDate() {
  const map = new Map();
  mockBookings.forEach((b) => {
    if (!b || b.status === 'cancelled') return;
    const key = typeof b.date === 'string' ? b.date.slice(0, 10) : null;
    if (!key) return;
    if (!map.has(key)) map.set(key, {});
    const bucket = map.get(key);
    const cat = b.serviceId || 'plumbing';
    bucket[cat] = (bucket[cat] || 0) + 1;
  });
  return map;
}

/**
 * The full series: `days` days of synthetic baseline ending yesterday, with real bookings added on
 * top of whichever dates they fall on.
 *
 * Ends YESTERDAY deliberately — today is still in progress, so a partial day would read as a slump
 * and drag the weighted moving average down.
 */
export function getDemandHistory(days = HISTORY_DAYS) {
  const real = realCountsByDate();
  const out = [];
  const today = new Date();

  for (let i = days; i >= 1; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const day = syntheticDay(key);

    const realForDay = real.get(key);
    if (realForDay) {
      let added = 0;
      Object.entries(realForDay).forEach(([cat, n]) => {
        if (day.categories[cat] == null) return; // ignore a service with no demand series
        day.categories[cat] += n;
        added += n;
      });
      day.total += added;
      day.realBookings = added;
    }
    out.push(day);
  }

  return out;
}

/** How many real bookings landed inside the history window — shown in the UI as provenance. */
export function countRealBookingsInHistory(days = HISTORY_DAYS) {
  return getDemandHistory(days).reduce((sum, d) => sum + (d.realBookings || 0), 0);
}
