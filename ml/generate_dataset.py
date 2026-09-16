"""
Builds the training dataset for the demand-forecast model.

    python ml/generate_dataset.py            # 730 days ending yesterday
    python ml/generate_dataset.py --days 365

Output: ml/data/demand_daily.csv — one row per (date, category), in long format.

FEATURE DESIGN
The target is a single day's demand for one trade. Everything the model is given has to be knowable
BEFORE that day starts, otherwise the metrics are inflated by leakage:

    day_of_week, is_weekend, month, day_of_year   calendar, known indefinitely ahead
    weather                                        a forecast input, not an observation
    festival_multiplier, days_to_festival          from a fixed festival calendar
    lag_1, lag_7                                   demand 1 and 7 days earlier
    roll_7, roll_28                                trailing means
    wma_7                                          recency-weighted mean, the same statistic the
                                                   hand-written engine used, kept as a feature so
                                                   the model can improve on it rather than relearn it

The first 28 rows per category are dropped, since their trailing windows are incomplete.

ZONE COLUMNS are included (zone_North … zone_Central) so a zone-level model can be trained later
without regenerating anything. They are NOT used by the current category model — bookings carry no
zone, so a zone prediction could never be validated against real activity.
"""

from __future__ import annotations

import argparse
import csv
from datetime import date, timedelta
from pathlib import Path

from synthetic import CATEGORIES, ZONES, date_range, festival_for, synthetic_day

OUT_DIR = Path(__file__).resolve().parent / "data"
OUT_FILE = OUT_DIR / "demand_daily.csv"

# Longest trailing window; rows before this have no complete history.
WARMUP_DAYS = 28


def weighted_moving_average(values: list[int], window: int = 7) -> float:
    """Recency-weighted mean — weights 1..window, matching forecastEngine.weightedMovingAverage."""
    if not values:
        return 0.0
    recent = values[-window:]
    weights = list(range(1, len(recent) + 1))
    return sum(v * w for v, w in zip(recent, weights)) / sum(weights)


def days_to_nearest_festival(date_str: str, category: str) -> int:
    """
    Signed distance in days to the nearest festival affecting this trade, clamped to +/-30.
    30 means "no festival in range", which the model can learn as the neutral case.
    """
    from synthetic import FESTIVALS

    target = date.fromisoformat(date_str)
    best = 30
    for fest in FESTIVALS:
        if category not in fest["categories"]:
            continue
        diff = abs((date.fromisoformat(fest["date"]) - target).days)
        best = min(best, diff)
    return best


def build_rows(days: int, end_day: date) -> list[dict]:
    dates = [d.isoformat() for d in date_range(end_day, days)]

    # Generate every day once; synthetic_day is pure so this is just avoiding repeated work.
    day_records = {d: synthetic_day(d) for d in dates}

    # Per-category history, appended as we walk forward, so lag/rolling features only ever look back.
    history: dict[str, list[int]] = {cat: [] for cat in CATEGORIES}
    rows: list[dict] = []

    for idx, date_str in enumerate(dates):
        rec = day_records[date_str]
        day = date.fromisoformat(date_str)

        for cat in CATEGORIES:
            past = history[cat]
            demand = rec["categories"][cat]

            if idx >= WARMUP_DAYS:
                fest_name, fest_mult = festival_for(date_str, cat)
                rows.append({
                    "date": date_str,
                    "category": cat,
                    "day_of_week": rec["day_of_week"],
                    "is_weekend": 1 if rec["day_of_week"] in (0, 6) else 0,
                    "month": day.month,
                    "day_of_year": day.timetuple().tm_yday,
                    "weather": rec["weather"],
                    "festival": fest_name or "",
                    "festival_multiplier": round(fest_mult, 4),
                    "days_to_festival": days_to_nearest_festival(date_str, cat),
                    "lag_1": past[-1],
                    "lag_7": past[-7],
                    "roll_7": round(sum(past[-7:]) / 7, 4),
                    "roll_28": round(sum(past[-28:]) / 28, 4),
                    "wma_7": round(weighted_moving_average(past, 7), 4),
                    **{f"zone_{z}": rec["zones"][z] for z in ZONES},
                    "demand": demand,
                })

            past.append(demand)

    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the synthetic demand dataset.")
    parser.add_argument("--days", type=int, default=730,
                        help="Total days to generate, including the %d-day warm-up." % WARMUP_DAYS)
    args = parser.parse_args()

    if args.days <= WARMUP_DAYS + 30:
        parser.error(f"--days must exceed {WARMUP_DAYS + 30} to leave usable rows after warm-up.")

    # Ends yesterday, matching getDemandHistory() in the app — today is still in progress.
    end_day = date.today() - timedelta(days=1)

    rows = build_rows(args.days, end_day)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with OUT_FILE.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    span = f"{rows[0]['date']} .. {rows[-1]['date']}"
    print(f"wrote {OUT_FILE.relative_to(Path(__file__).resolve().parent.parent)}")
    print(f"  rows       {len(rows):,}  ({len(CATEGORIES)} categories x {len(rows)//len(CATEGORIES):,} days)")
    print(f"  date span  {span}")
    print(f"  features   {len(rows[0]) - 1} (+ demand target)")
    print(f"  warm-up    first {WARMUP_DAYS} days dropped (incomplete trailing windows)")
    print()
    print("NOTE: this data is synthetic. Metrics from it measure the pipeline, not real-world skill.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
