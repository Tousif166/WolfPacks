/**
 * Fairness allocation demo — the ONE hardcoded roster behind the customer's GPS scan and the
 * worker's allocation diagnosis.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS HARDCODED:
 * The live matching engine (src/services/geoMatchingService.js) is the real thing — it filters on
 * service, availability, leave and radius, and ranks what is genuinely there. In this build that
 * honestly resolves to ONE eligible plumber, which makes for a truthful engine and a useless
 * demonstration: you cannot show "why this worker and not the others" with a pool of one.
 *
 * So the walkthrough gets its own fixed cast. Four professionals, fixed distances, fixed weekly
 * earnings, fixed ratings — identical on every device, every launch, and for every worker who
 * accepts the job. That is deliberate: the customer's scan animation and the worker's diagnosis are
 * two views of the SAME numbers, so the story the customer is shown and the story the worker is
 * shown can never disagree.
 *
 * It is kept out of geoMatchingService on purpose. Mixing a scripted roster into the real engine
 * would make the engine dishonest; keeping it here makes it obvious that this is presentation.
 *
 * ONE PLACE TO CHANGE THE STORY. Every number the UI shows is derived from ROSTER below by the
 * exported helpers — no screen recomputes or re-hardcodes anything.
 */

/** The scan radius the animation and the comparisons describe. Matches DEFAULT_MATCHING_RADIUS_KM. */
export const ALLOCATION_RADIUS_KM = 10;

/**
 * Weekly-earnings ceiling used to turn "earned so far this week" into a 0..1 fairness sub-score.
 *
 * Fixed rather than derived from the roster's own max, so the earnings axis means the same thing
 * regardless of who happens to be in a scan: it is "how much of a full week's work have you already
 * had", not "how do you compare to today's three rivals".
 */
export const ALLOCATION_EARNINGS_CEILING = 9000;

/**
 * Axis weights. Sum to 1.
 *
 * Distance leads because it decides how fast the customer is helped. Earnings is weighted close
 * behind it because that is the cooperative's whole point — a worker who has already had a good week
 * should not also take the next job. Rating counts least, so a popular worker cannot monopolise the
 * queue on reputation alone.
 */
export const ALLOCATION_WEIGHTS = { distance: 0.4, earnings: 0.35, rating: 0.25 };

/** Where the selected worker sets off from — the origin of the live-tracking route (mockRoutes). */
export const ALLOCATION_ORIGIN_PLACE = 'Ruby General Hospital';

/**
 * The scanned professionals.
 *
 * `pin` is a position inside the radar square as a fraction of its width/height, with the customer
 * at the centre (0.5, 0.5). Chosen so the four markers are well separated on screen AND so their
 * on-screen distance from the centre reads consistently with `distanceKm` — a marker shown near the
 * rim must not claim to be the closest.
 *
 * The winner leads on all three axes (nearest, least earned, best rated). That is not a coincidence
 * dressed up as one: an allocation demo has to be unambiguous, because a worker reading the
 * diagnosis should not have to weigh trade-offs to see why the job reached them.
 *
 * `selected: true` marks the single worker the fairness system picks. Exactly one entry carries it;
 * `getAllocationDemo` asserts nothing, but the helpers all assume the highest score is that worker,
 * which the numbers below satisfy (76.7 vs 56.6 / 49.9 / 46.5).
 */
const ROSTER = [
  {
    id: 'w1',
    name: 'Suresh Kumar',
    cooperative: 'Delhi Workers Cooperative Society',
    selected: true,
    distanceKm: 0.9,
    etaMins: 6,
    rating: 4.8,
    weekEarnings: 4820,
    weekJobs: 5,
    startPlace: ALLOCATION_ORIGIN_PLACE,
    pin: { x: 0.575, y: 0.425 },
  },
  {
    id: 'ac2',
    name: 'Dilip Mandal',
    cooperative: 'Kolkata Workers Cooperative Society',
    selected: false,
    distanceKm: 3.4,
    etaMins: 14,
    rating: 4.6,
    weekEarnings: 7150,
    weekJobs: 9,
    startPlace: 'Kasba Golpark',
    pin: { x: 0.255, y: 0.29 },
  },
  {
    id: 'ac3',
    name: 'Farhan Ali',
    cooperative: 'Kolkata Workers Cooperative Society',
    selected: false,
    distanceKm: 5.6,
    etaMins: 22,
    rating: 4.5,
    weekEarnings: 6480,
    weekJobs: 8,
    startPlace: 'Park Circus',
    pin: { x: 0.775, y: 0.735 },
  },
  {
    id: 'ac4',
    name: 'Sanjay Bera',
    cooperative: 'Bengal Sahakar Samiti',
    selected: false,
    distanceKm: 7.2,
    etaMins: 28,
    rating: 4.7,
    weekEarnings: 5960,
    weekJobs: 7,
    startPlace: 'Jadavpur',
    pin: { x: 0.215, y: 0.775 },
  },
];

/** How many professionals the scan turns up. Read by copy that says "{n} found". */
export const ALLOCATION_CANDIDATE_COUNT = ROSTER.length;

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const round1 = (n) => Math.round(n * 10) / 10;

/** Nearer is better: linear decay across the scan radius, 0 km = 1, at/beyond the rim = 0. */
export function distanceSubScore(distanceKm) {
  return clamp01(1 - distanceKm / ALLOCATION_RADIUS_KM);
}

/**
 * LESS earned this week is better — this is the axis that makes the queue fair rather than
 * competitive. A worker at the ceiling scores 0, one who has earned nothing scores 1.
 */
export function earningsSubScore(weekEarnings) {
  return clamp01(1 - weekEarnings / ALLOCATION_EARNINGS_CEILING);
}

/** Rating out of 5, normalised. Weighted least of the three on purpose. */
export function ratingSubScore(rating) {
  return clamp01(rating / 5);
}

/** Weighted fairness score, 0..100, one decimal. */
export function allocationScore({ distanceKm, weekEarnings, rating }) {
  const raw =
    ALLOCATION_WEIGHTS.distance * distanceSubScore(distanceKm) +
    ALLOCATION_WEIGHTS.earnings * earningsSubScore(weekEarnings) +
    ALLOCATION_WEIGHTS.rating * ratingSubScore(rating);
  return Math.round(raw * 1000) / 10;
}

/**
 * The whole comparison, derived from ROSTER.
 *
 * `youName` renames the selected candidate to the signed-in worker and flags them `isYou`, which is
 * what lets the worker portal say "you" while the customer portal says "Suresh Kumar" from the same
 * roster. Everything else is identical between the two, so the customer's scan and the worker's
 * diagnosis are guaranteed to be telling the same story.
 *
 * Returns pre-sorted views (`byScore`, `byDistance`, `byEarnings`) rather than making each screen
 * sort for itself — three components sorting the same data three times is three chances to order it
 * differently and contradict the verdict printed underneath.
 */
export function getAllocationDemo({ youName } = {}) {
  const scored = ROSTER.map((c) => {
    const score = allocationScore(c);
    return {
      ...c,
      score,
      // Only the selected candidate is ever relabelled — a rival keeps its roster name even in the
      // (harmless) case that it matches the signed-in worker's.
      displayName: c.selected && youName ? youName : c.name,
      isYou: !!(c.selected && youName),
      sub: {
        distance: distanceSubScore(c.distanceKm),
        earnings: earningsSubScore(c.weekEarnings),
        rating: ratingSubScore(c.rating),
      },
    };
  });

  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const byDistance = [...scored].sort((a, b) => a.distanceKm - b.distanceKm);
  // Ascending: the worker who has earned the LEAST this week is at the top, because that is the one
  // the fairness queue favours. Rendering this descending would invert the meaning of the panel.
  const byEarnings = [...scored].sort((a, b) => a.weekEarnings - b.weekEarnings);

  const winner = byScore[0];
  const runnerUpByDistance = byDistance[1];
  const runnerUpByEarnings = byEarnings[1];
  const others = scored.filter((c) => !c.selected);

  const average = (nums) => nums.reduce((sum, n) => sum + n, 0) / nums.length;

  return {
    candidates: scored,
    byScore,
    byDistance,
    byEarnings,
    winner,
    others,
    radiusKm: ALLOCATION_RADIUS_KM,
    weights: ALLOCATION_WEIGHTS,
    originPlace: ALLOCATION_ORIGIN_PLACE,
    count: scored.length,
    gaps: {
      // How much better the winner was than the NEXT best on each axis — the number that turns
      // "they won" into "they won by this much".
      distanceKm: round1(runnerUpByDistance.distanceKm - winner.distanceKm),
      earnings: runnerUpByEarnings.weekEarnings - winner.weekEarnings,
      score: round1(winner.score - byScore[1].score),
    },
    averages: {
      distanceKm: round1(average(scored.map((c) => c.distanceKm))),
      earnings: Math.round(average(scored.map((c) => c.weekEarnings))),
      rating: round1(average(scored.map((c) => c.rating))),
      otherRating: round1(average(others.map((c) => c.rating))),
    },
  };
}

/**
 * Rupee grouping in the Indian convention — 4820 -> "4,820", 173500 -> "1,73,500".
 *
 * Hand-rolled rather than `toLocaleString('en-IN')` because Hermes only groups correctly when the
 * build ships the Intl-enabled variant. A currency figure that silently loses its separators on some
 * devices is worse than a five-line formatter.
 */
export function formatRupees(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  const digits = String(Math.round(Math.abs(amount)));
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  // Everything above the last three digits is grouped in PAIRS, which is what makes this Indian
  // rather than Western grouping.
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return amount < 0 ? `-${grouped}` : grouped;
}
