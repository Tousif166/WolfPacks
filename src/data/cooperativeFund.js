/**
 * Cooperative welfare fund — where the 2% welfare cess on every booking actually goes.
 *
 * WHY THIS FILE EXISTS: the cess was already being charged and shown on the invoice
 * ("Cooperative Welfare Cess @ 2%"), but nothing anywhere said what it was for. A 2% deduction with
 * no stated destination is exactly the kind of line a worker or a customer is right to distrust. This
 * module defines the destination once, and both ends of the app read it from here — the customer's
 * invoice preview and the admin dashboard's fund panel — so the split a customer is shown is
 * arithmetically the same split the cooperative reports.
 *
 * IT IS A COLLECTIVE POOL, NOT A PER-WORKER BALANCE. Nothing in here is keyed by worker id, and that
 * is the design, not an omission: the cess from every transaction on the platform lands in one
 * reserve that the cooperative spends on behalf of its members. No worker has a withdrawable share,
 * so there is deliberately no API here to compute one.
 *
 * THE SPLIT IS EXACT, NOT APPROXIMATE. Everything is computed in integer paise and the last division
 * takes the remainder, so the three parts always re-add to the cess to the last paisa. Rounding each
 * share independently would routinely leave the parts a paisa short of the whole, which on a
 * financial breakdown is not a cosmetic problem — it is the breakdown contradicting the invoice.
 */

/** The cess rate charged on the weather-adjusted base. Mirrors calcBilling in BookingScreen. */
export const WELFARE_CESS_RATE = 0.02;

/**
 * How the cess divides three ways. Fractions of the CESS, not of each other, so they sum to 1.
 *
 * The reasoning behind these weights:
 *  - Platform upkeep takes the smallest slice. It is a real cost (servers, payment fees, support),
 *    but a cooperative whose own overhead outgrew its member benefits would have lost the plot.
 *  - Emergency relief takes the largest, because it is the part that cannot wait. An accident or a
 *    hospital bill is what pushes an informal-sector household into debt, and it is the one risk an
 *    individual worker cannot self-insure against.
 *  - Tools sits between them: it is what raises earning capacity over time rather than covering a
 *    crisis, so it is important but never urgent, and it can absorb a lean month.
 */
export const FUND_SPLIT = {
  appMaintenance: 0.25,
  emergency: 0.45,
  tools: 0.3,
};

/** The two emergency+tools divisions are the "cooperative fund" proper — 75% of the cess. */
export const COOPERATIVE_FUND_SHARE = FUND_SPLIT.emergency + FUND_SPLIT.tools;

/** Stable ids + presentation order for the three divisions. Used as React keys and lookup keys. */
export const FUND_DIVISIONS = [
  { id: 'appMaintenance', share: FUND_SPLIT.appMaintenance, group: 'platform' },
  { id: 'emergency', share: FUND_SPLIT.emergency, group: 'cooperative' },
  { id: 'tools', share: FUND_SPLIT.tools, group: 'cooperative' },
];

/**
 * Splits one booking's cess three ways, exactly.
 *
 * Returns rupee NUMBERS (two decimals) plus the paise integers they came from, because on a single
 * booking the cess is a few rupees and the shares are genuinely fractional — a ₹8 cess divides into
 * ₹2.00 / ₹3.60 / ₹2.40, and rounding those to whole rupees would both distort the percentages and
 * lose money out of the total.
 */
export function splitWelfareCess(cessAmount) {
  const totalPaise = Math.max(0, Math.round((Number(cessAmount) || 0) * 100));
  const appPaise = Math.round(totalPaise * FUND_SPLIT.appMaintenance);
  const emergencyPaise = Math.round(totalPaise * FUND_SPLIT.emergency);
  // The final division absorbs the rounding remainder, which is what guarantees the parts sum to
  // the whole. Tools is chosen for this because it is the smallest cooperative-side share, so a
  // one-paisa adjustment is proportionally least significant there.
  const toolsPaise = totalPaise - appPaise - emergencyPaise;

  const toRupees = (paise) => Math.round(paise) / 100;

  return {
    total: toRupees(totalPaise),
    appMaintenance: toRupees(appPaise),
    emergency: toRupees(emergencyPaise),
    tools: toRupees(toolsPaise),
    cooperativeFund: toRupees(emergencyPaise + toolsPaise),
    paise: { total: totalPaise, appMaintenance: appPaise, emergency: emergencyPaise, tools: toolsPaise },
  };
}

/**
 * The cooperative's running ledger for the pool.
 *
 * SEEDED DEMO FIGURES, and flagged as such rather than dressed up as a live query. There is no
 * fund-ledger table to read: the cess is computed per booking at invoice time and never accumulated
 * anywhere, and the handful of bookings in mockBookings would total a pool of a few hundred rupees —
 * too small to show a meaningful three-way division. So the pool is a fixed figure representing the
 * cooperative's history, and it is INTERNALLY CONSISTENT rather than a round number picked at random:
 *
 *   34,920 / 4,186 bookings = ₹8.34 average cess per booking
 *
 * which is what a 2% cess on this catalogue's ~₹390–500 weather-adjusted base actually produces (the
 * plumbing booking on the invoice preview contributes ₹8). The month figures divide the same way
 * (2,140 / 257 = ₹8.33). Anyone who checks the arithmetic finds it holds.
 *
 * 34,920 is also divisible such that all three divisions are whole rupees, so the dashboard never
 * shows a lifetime pool with stray paise.
 */
export const FUND_LEDGER = {
  poolTotal: 34920,
  contributingBookings: 4186,
  monthTotal: 2140,
  monthBookings: 257,
  /** When the cooperative started collecting the cess. Used in the "pooled since" line. */
  sinceLabel: 'Apr 2025',
  /** Marks the figures above as seeded, so a UI can label them honestly if it wants to. */
  isSeeded: true,
};

/**
 * The pool, divided.
 *
 * Same split function as a single booking's cess, applied to the accumulated total — so the
 * percentages on the customer's invoice and the amounts on the admin dashboard cannot drift apart.
 */
export function getCooperativeFundPool() {
  const split = splitWelfareCess(FUND_LEDGER.poolTotal);
  const month = splitWelfareCess(FUND_LEDGER.monthTotal);
  return {
    ...FUND_LEDGER,
    split,
    month,
    /** Average cess contributed per booking, to two decimals. */
    averagePerBooking:
      FUND_LEDGER.contributingBookings > 0
        ? Math.round((FUND_LEDGER.poolTotal / FUND_LEDGER.contributingBookings) * 100) / 100
        : 0,
  };
}

/** Indian-convention grouping — 34920 -> "34,920", 234920 -> "2,34,920". */
export function formatFundAmount(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  const whole = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - whole) * 100);
  const digits = String(whole);
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  // Paise are shown only when they exist, so a lifetime total reads "34,920" while a single
  // booking's share reads "3.60" instead of a misleading whole rupee.
  const body = paise > 0 ? `${grouped}.${String(paise).padStart(2, '0')}` : grouped;
  return amount < 0 ? `-${body}` : body;
}
