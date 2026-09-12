"""
Trains the demand-forecast model and exports it for in-app inference.

    python ml/train.py

Reads   ml/data/demand_daily.csv          (from generate_dataset.py)
Writes  src/data/forecastModel.json       (committed; the app reads this at runtime)

WHY TWO MODELS ARE EXPORTED
  gbm    gradient-boosted trees — the accurate one, used by default in the app.
  ridge  a linear model — weaker, but its weights are a flat vector, which means they can be
         updated on-device with a few lines of SGD if the app should ever learn from new bookings
         rather than only score them. Kept as the option that keeps that door open.

VALIDATION IS CHRONOLOGICAL, NOT RANDOM
This is a time series. A random split lets the model see the future — a row from March in training
and its neighbour from the same week in test — which inflates the score badly. The last 20% of dates
are held out instead, so the test set is strictly later than everything trained on.

THE HONEST BASELINE
wma_7 (the recency-weighted moving average the hand-written engine used) is scored as a baseline.
If the trained model does not beat it, the model is not worth shipping, and the comparison is
printed either way rather than quietly omitted.

REMINDER ON WHAT THE NUMBERS MEAN
The data is synthetic (see synthetic.py). These metrics show the pipeline fits the injected
structure. They are not evidence of real-world forecasting skill.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score

from synthetic import CATEGORIES, WEATHER_KINDS

ML_DIR = Path(__file__).resolve().parent
REPO_ROOT = ML_DIR.parent
DATA_FILE = ML_DIR / "data" / "demand_daily.csv"
OUT_FILE = REPO_ROOT / "src" / "data" / "forecastModel.json"

MODEL_VERSION = "1.0.0"
TEST_FRACTION = 0.2

# Distinct weather values, order fixed so the one-hot encoding matches the JS side exactly.
WEATHER_VALUES = sorted(set(WEATHER_KINDS))

NUMERIC_FEATURES = [
    "day_of_week",
    "is_weekend",
    "month",
    "day_of_year",
    "festival_multiplier",
    "days_to_festival",
    "lag_1",
    "lag_7",
    "roll_7",
    "roll_28",
    "wma_7",
]


def feature_names() -> list[str]:
    """The exact feature order the exported model expects. JS must build vectors in this order."""
    return (
        NUMERIC_FEATURES
        + [f"cat_{c}" for c in CATEGORIES]
        + [f"wx_{w}" for w in WEATHER_VALUES]
    )


def build_matrix(df: pd.DataFrame) -> np.ndarray:
    """One-hot encode category and weather, then concatenate with the numeric columns."""
    numeric = df[NUMERIC_FEATURES].to_numpy(dtype=float)
    cat_oh = np.column_stack([(df["category"] == c).to_numpy(dtype=float) for c in CATEGORIES])
    wx_oh = np.column_stack([(df["weather"] == w).to_numpy(dtype=float) for w in WEATHER_VALUES])
    return np.hstack([numeric, cat_oh, wx_oh])


def mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Mean absolute percentage error. Guarded against zero actuals."""
    safe = np.where(actual == 0, np.nan, actual)
    return float(np.nanmean(np.abs((actual - predicted) / safe)) * 100)


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict:
    return {
        "mae": round(float(mean_absolute_error(actual, predicted)), 3),
        "mape": round(mape(actual, predicted), 2),
        "r2": round(float(r2_score(actual, predicted)), 4),
    }


def export_tree(tree) -> dict:
    """
    Flatten one sklearn decision tree into parallel arrays.

    Arrays rather than nested objects because traversal in JS is then a simple index walk with no
    allocation, and the JSON is markedly smaller.

    A LEAF IS `left == -1` (sklearn's TREE_LEAF). `feature` holds TREE_UNDEFINED = -2 at leaves, so
    consumers must not use feature == -1 as the leaf test.
    """
    # THRESHOLDS ARE EXPORTED UNROUNDED, deliberately.
    #
    # sklearn's thresholds are float32 values widened to float64, e.g. 22.78569984436035. Rounding
    # even to 9 decimals yields 22.785699844 — very slightly BELOW the true value — which flips the
    # `<=` test for any sample sitting exactly on that boundary and routes it to the wrong leaf. One
    # such row in 1128 was enough to shift a prediction by 0.18. Full repr costs a few KB and makes
    # the export bit-exact.
    t = tree.tree_
    return {
        "feature": [int(f) for f in t.feature],
        "threshold": [float(v) for v in t.threshold],
        "left": [int(v) for v in t.children_left],
        "right": [int(v) for v in t.children_right],
        "value": [float(v[0][0]) for v in t.value],
    }


def main() -> int:
    if not DATA_FILE.exists():
        print(f"missing {DATA_FILE}. Run: python ml/generate_dataset.py")
        return 1

    # keep_default_na=False so the empty festival string stays an empty string, not NaN.
    df = pd.read_csv(DATA_FILE, keep_default_na=False)
    df = df.sort_values(["date", "category"]).reset_index(drop=True)

    # ---- chronological split on DATES, so no date straddles the boundary ----
    dates = sorted(df["date"].unique())
    split_at = dates[int(len(dates) * (1 - TEST_FRACTION))]
    train_df = df[df["date"] < split_at]
    test_df = df[df["date"] >= split_at]

    x_train, y_train = build_matrix(train_df), train_df["demand"].to_numpy(dtype=float)
    x_test, y_test = build_matrix(test_df), test_df["demand"].to_numpy(dtype=float)

    print(f"train {x_train.shape[0]:,} rows  ({train_df['date'].min()} .. {train_df['date'].max()})")
    print(f"test  {x_test.shape[0]:,} rows  ({test_df['date'].min()} .. {test_df['date'].max()})")
    print(f"features {x_train.shape[1]}")
    print()

    # ---- baseline: the heuristic the app used before any model existed ----
    baseline = metrics(y_test, test_df["wma_7"].to_numpy(dtype=float))

    # ---- gradient boosting ----
    gbm = GradientBoostingRegressor(
        n_estimators=120, max_depth=3, learning_rate=0.08,
        subsample=0.9, random_state=42,
    )
    gbm.fit(x_train, y_train)
    gbm_metrics = metrics(y_test, gbm.predict(x_test))

    # ---- ridge, on standardised features so one coefficient vector is meaningful ----
    mean = x_train.mean(axis=0)
    scale = x_train.std(axis=0)
    scale[scale == 0] = 1.0
    ridge = Ridge(alpha=1.0)
    ridge.fit((x_train - mean) / scale, y_train)
    ridge_metrics = metrics(y_test, ridge.predict((x_test - mean) / scale))

    print(f"{'model':<22} {'MAE':>8} {'MAPE':>8} {'R2':>8}")
    print(f"{'wma_7 (old heuristic)':<22} {baseline['mae']:>8.3f} {baseline['mape']:>7.2f}% {baseline['r2']:>8.4f}")
    print(f"{'ridge':<22} {ridge_metrics['mae']:>8.3f} {ridge_metrics['mape']:>7.2f}% {ridge_metrics['r2']:>8.4f}")
    print(f"{'gradient boosting':<22} {gbm_metrics['mae']:>8.3f} {gbm_metrics['mape']:>7.2f}% {gbm_metrics['r2']:>8.4f}")
    print()

    improvement = (baseline["mae"] - gbm_metrics["mae"]) / baseline["mae"] * 100
    if gbm_metrics["mae"] < baseline["mae"]:
        print(f"gradient boosting beats the old heuristic by {improvement:.1f}% on MAE.")
    else:
        print("WARNING: the trained model does NOT beat the wma_7 heuristic. Do not ship it as an")
        print("improvement — investigate the features before wiring it into the app.")
    print()

    # ---- top features, for the write-up and for sanity ----
    order = np.argsort(gbm.feature_importances_)[::-1][:8]
    names = feature_names()
    print("top features by importance:")
    for i in order:
        print(f"  {names[i]:<24} {gbm.feature_importances_[i]:.4f}")
    print()

    payload = {
        "version": MODEL_VERSION,
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataSource": "synthetic",
        "featureNames": names,
        "categories": CATEGORIES,
        "weatherValues": WEATHER_VALUES,
        "numericFeatures": NUMERIC_FEATURES,
        "trainRows": int(x_train.shape[0]),
        "testRows": int(x_test.shape[0]),
        "trainSpan": [str(train_df["date"].min()), str(train_df["date"].max())],
        "testSpan": [str(test_df["date"].min()), str(test_df["date"].max())],
        "metrics": {"gbm": gbm_metrics, "ridge": ridge_metrics, "baselineWma7": baseline},
        "gbm": {
            "learningRate": float(gbm.learning_rate),
            "initial": round(float(np.mean(y_train)), 9),
            "trees": [export_tree(est[0]) for est in gbm.estimators_],
        },
        "ridge": {
            "intercept": round(float(ridge.intercept_), 9),
            "coefficients": [round(float(c), 9) for c in ridge.coef_],
            "mean": [round(float(v), 9) for v in mean],
            "scale": [round(float(v), 9) for v in scale],
        },
    }

    # ---- verify the EXPORT reproduces the fitted estimator, in-process ----
    # Done here rather than in a separate script because re-fitting elsewhere cannot be guaranteed
    # to reproduce this exact estimator, which makes any cross-process comparison unreliable.
    def score_exported(row: np.ndarray) -> float:
        total = 0.0
        for tree in payload["gbm"]["trees"]:
            node = 0
            while tree["left"][node] != -1:  # TREE_LEAF; `feature` holds -2 at leaves
                feat = tree["feature"][node]
                # float32, because sklearn casts X to float32 before traversal and its thresholds
                # are float32 widened to float64. In float64 a value sitting exactly on a split
                # boundary routes the wrong way. JS mirrors this with Math.fround.
                value = float(np.float32(row[feat]))
                node = tree["left"][node] if value <= tree["threshold"][node] else tree["right"][node]
            total += tree["value"][node]
        return payload["gbm"]["initial"] + payload["gbm"]["learningRate"] * total

    exported_pred = np.array([score_exported(r) for r in x_test])
    export_drift = float(np.max(np.abs(gbm.predict(x_test) - exported_pred)))
    print(f"export fidelity    max |sklearn - exported| = {export_drift:.3e}")
    if export_drift > 1e-6:
        print("FAILED — the exported JSON does not reproduce the fitted model. Not writing it.")
        return 1
    print()

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    size_kb = OUT_FILE.stat().st_size / 1024
    print(f"wrote {OUT_FILE.relative_to(REPO_ROOT)}  ({size_kb:.1f} KB, {len(payload['gbm']['trees'])} trees)")
    print()
    print("REMINDER: trained on synthetic data. The metrics above measure the pipeline, not")
    print("real-world forecasting skill.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
