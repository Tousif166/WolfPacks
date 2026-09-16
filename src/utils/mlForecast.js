import model from '@data/forecastModel.json';
import { festivalFor, weatherFor, dateKey } from '@data/demandHistory';
import { categories as ALL_CATEGORIES, festivals } from '@data/mockHistoricalDemand';

/**
 * mlForecast — runs the Python-trained demand model on device.
 *
 * The model is trained offline by ml/train.py and exported to src/data/forecastModel.json as plain
 * arrays: the boosted trees as parallel index arrays, and the ridge model as a coefficient vector.
 * Scoring here is an index walk and a dot product, so there is NO native module, NO inference
 * runtime, and NO network call — it works fully offline and needed no Gradle rebuild.
 *
 * FEATURE ORDER IS A CONTRACT. `model.featureNames` is the exact order train.py used, and
 * buildFeatureVector must reproduce it. If the two ever disagree the predictions become silent
 * nonsense, so ml/check_inference.py asserts that this file and scikit-learn agree numerically.
 *
 * MULTI-STEP FORECASTING IS RECURSIVE: predicting day 3 needs day 2's demand, which is itself a
 * prediction. Each prediction is appended to the working history before the next step, exactly as
 * the previous hand-written engine did. Error compounds with horizon, which is why the confidence
 * band widens further out.
 */

/** Trailing windows the features need; the history must be at least this long to be meaningful. */
const MAX_LOOKBACK = 28;

/** Recency-weighted mean — weights 1..window. Mirrors weighted_moving_average in generate_dataset.py. */
export function weightedMovingAverage(values, window = 7) {
  if (!values.length) return 0;
  const recent = values.slice(-window);
  let weighted = 0;
  let totalWeight = 0;
  recent.forEach((v, i) => {
    const w = i + 1;
    weighted += v * w;
    totalWeight += w;
  });
  return totalWeight ? weighted / totalWeight : 0;
}

function mean(values, window) {
  const recent = values.slice(-window);
  if (!recent.length) return 0;
  return recent.reduce((s, v) => s + v, 0) / window;
}

/** Day of the year, 1-366. Matches Python's timetuple().tm_yday. */
function dayOfYear(d) {
  const start = Date.UTC(d.getFullYear(), 0, 1);
  const current = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((current - start) / 86400000) + 1;
}

/**
 * Days to the nearest festival affecting this trade, clamped at 30 ("none in range").
 * Mirrors days_to_nearest_festival in generate_dataset.py, including the annual recurrence.
 */
function daysToFestival(dateStr, category) {
  const target = new Date(`${dateStr}T00:00:00`);
  const year = target.getFullYear();
  let best = 30;
  festivals.forEach((f) => {
    if (!f.affectedCategories.includes(category)) return;
    const [, month, day] = f.date.split('-').map(Number);
    [year - 1, year, year + 1].forEach((y) => {
      const diff = Math.abs((new Date(y, month - 1, day) - target) / 86400000);
      if (diff < best) best = diff;
    });
  });
  return best;
}

/**
 * Builds one feature vector in `model.featureNames` order.
 * `history` is that category's demand series, oldest first, ending the day before `dateStr`.
 */
export function buildFeatureVector(dateStr, category, weather, history) {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay();
  const fest = festivalFor(dateStr, category);

  const numeric = {
    day_of_week: dow,
    is_weekend: dow === 0 || dow === 6 ? 1 : 0,
    month: d.getMonth() + 1,
    day_of_year: dayOfYear(d),
    festival_multiplier: fest.multiplier,
    days_to_festival: daysToFestival(dateStr, category),
    lag_1: history[history.length - 1] ?? 0,
    lag_7: history[history.length - 7] ?? 0,
    roll_7: mean(history, 7),
    roll_28: mean(history, 28),
    wma_7: weightedMovingAverage(history, 7),
  };

  const vector = model.numericFeatures.map((name) => numeric[name] ?? 0);
  model.categories.forEach((c) => vector.push(c === category ? 1 : 0));
  model.weatherValues.forEach((w) => vector.push(w === weather ? 1 : 0));
  return vector;
}

/**
 * Walks one exported tree to its leaf.
 *
 * Two non-obvious details, both found by ml/check_inference.py rather than by reading the docs:
 *
 * 1. A LEAF IS `left === -1` (scikit-learn's TREE_LEAF). It is NOT `feature === -1` — sklearn puts
 *    TREE_UNDEFINED = -2 in `feature` at leaves, so testing against -1 walks off the end of the
 *    arrays and loops forever.
 *
 * 2. THE COMPARISON MUST BE IN FLOAT32. sklearn casts X to float32 before traversal, and its
 *    thresholds are float32 values widened to float64 on export. Comparing a float64 feature
 *    against such a threshold disagrees whenever the value sits exactly on a split boundary — e.g.
 *    a wma_7 of 22.7857 against a threshold of 22.78569984436035, where float32 says equal (go
 *    left) and float64 says greater (go right). Math.fround reproduces sklearn's precision, and
 *    without it roughly 1 row in 1000 is routed to the wrong leaf.
 */
function scoreTree(tree, x) {
  let node = 0;
  while (tree.left[node] !== -1) {
    node = Math.fround(x[tree.feature[node]]) <= tree.threshold[node] ? tree.left[node] : tree.right[node];
  }
  return tree.value[node];
}

/**
 * Gradient-boosting prediction, matching scikit-learn:
 *     initial + learningRate * sum(leaf values)
 * where `initial` is the training mean (the squared-error loss init).
 */
export function predictGbm(x) {
  const { initial, learningRate, trees } = model.gbm;
  let sum = 0;
  for (let i = 0; i < trees.length; i++) sum += scoreTree(trees[i], x);
  return initial + learningRate * sum;
}

/** Ridge prediction on standardised features. Kept for the on-device-update path. */
export function predictRidge(x) {
  const { intercept, coefficients, mean: mu, scale } = model.ridge;
  let sum = intercept;
  for (let i = 0; i < coefficients.length; i++) {
    sum += ((x[i] - mu[i]) / (scale[i] || 1)) * coefficients[i];
  }
  return sum;
}

export function predict(x, kind = 'gbm') {
  return kind === 'ridge' ? predictRidge(x) : predictGbm(x);
}

/**
 * Forecast one category forward.
 *
 * `history` — the demand series for this category from getDemandHistory(), oldest first.
 * `weatherByDate` — the weather assumption per future date. Passed in rather than derived so the
 *   caller can re-roll it on each regenerate; that is what makes a re-run produce a genuinely
 *   different forecast instead of repeating itself.
 */
export function forecastCategory(history, category, days = 7, weatherByDate = null, startDate = new Date()) {
  const working = [...history];
  const out = [];

  for (let i = 1; i <= days; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    d.setDate(d.getDate() + i);
    const dateStr = dateKey(d);
    const weather = weatherByDate?.[dateStr] || weatherFor(dateStr);

    const x = buildFeatureVector(dateStr, category, weather, working);
    const predicted = Math.max(0, Math.round(predict(x)));

    // Band widens with horizon: further out, the recursive inputs are themselves predictions.
    const band = 0.12 + i * 0.02;
    const fest = festivalFor(dateStr, category);

    out.push({
      date: dateStr,
      dayName: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
      predicted,
      confidence: [Math.round(predicted * (1 - band)), Math.round(predicted * (1 + band))],
      weather,
      festival: fest.name,
    });

    working.push(predicted); // recursive: this prediction feeds the next day's lags
  }

  return out;
}

/**
 * Forecast every category and sum to a daily total, so the "All" view and the per-category views
 * come from the SAME model rather than two different code paths.
 */
export function forecastAll(seriesByCategory, days = 7, weatherByDate = null, startDate = new Date()) {
  const perCategory = {};
  ALL_CATEGORIES.forEach((cat) => {
    perCategory[cat] = forecastCategory(seriesByCategory[cat] || [], cat, days, weatherByDate, startDate);
  });

  const totals = [];
  for (let i = 0; i < days; i++) {
    let predicted = 0;
    const breakdown = {};
    ALL_CATEGORIES.forEach((cat) => {
      const value = perCategory[cat][i]?.predicted || 0;
      breakdown[cat] = value;
      predicted += value;
    });
    const first = perCategory[ALL_CATEGORIES[0]][i];
    const band = 0.12 + (i + 1) * 0.02;
    totals.push({
      date: first.date,
      dayName: first.dayName,
      predicted,
      confidence: [Math.round(predicted * (1 - band)), Math.round(predicted * (1 + band))],
      weather: first.weather,
      festival: first.festival,
      categories: breakdown,
    });
  }

  return { totals, perCategory };
}

/** Turns getDemandHistory() output into per-category series for the functions above. */
export function historyByCategory(history) {
  const out = {};
  ALL_CATEGORIES.forEach((cat) => {
    out[cat] = history.map((day) => day.categories[cat] ?? 0);
  });
  return out;
}

/** Provenance for the UI — real trained metrics, not decoration. */
export const modelInfo = {
  version: model.version,
  trainedAt: model.trainedAt,
  dataSource: model.dataSource,
  trainRows: model.trainRows,
  testRows: model.testRows,
  trainSpan: model.trainSpan,
  testSpan: model.testSpan,
  metrics: model.metrics,
  treeCount: model.gbm.trees.length,
  featureCount: model.featureNames.length,
  minHistory: MAX_LOOKBACK,
};
