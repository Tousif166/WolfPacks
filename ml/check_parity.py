"""
Asserts that ml/synthetic.py and src/data/demandHistory.js generate the SAME series.

Why this exists: the model is trained on the Python generator and scored on the JS one. If the two
drift — a changed constant, a different rounding rule, a reordered PRNG draw — the model would be
predicting a distribution the app never produces, and the reported accuracy would be fiction. This
turns that silent failure into a loud one.

Run:  python ml/check_parity.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path

from synthetic import CATEGORIES, ZONES, synthetic_day

REPO_ROOT = Path(__file__).resolve().parent.parent

# A spread of dates: month boundaries, a leap day, and ordinary days.
SAMPLE_DATES = [
    # Ordinary days, month boundaries, a leap day.
    "2026-01-01", "2026-02-28", "2026-06-30", "2026-09-11", "2026-12-31", "2028-02-29",
    # Festival dates and their shoulders, in several years — these exercise the annual recurrence
    # and the proximity decay, which is where the two implementations are most likely to diverge.
    "2024-10-20", "2025-10-17", "2026-10-20", "2026-10-25",
    "2025-03-14", "2027-03-14", "2026-09-07", "2026-10-02",
]

# Loads syntheticDay out of the ES-module source without adding a Babel dev dependency: strip the
# import lines, supply the few bindings they provided, and evaluate. `mockBookings` is shimmed to []
# because syntheticDay never touches it — only the real-booking overlay does, which is not under
# test here.
JS_HARNESS = r"""
const fs = require('fs');
function load(file, exportNames, extraHead) {
  const src = fs.readFileSync(file, 'utf8')
    .replace(/^import[^;]+;/gm, '')
    .replace(/^export /gm, '');
  const mod = { exports: {} };
  new Function('module', (extraHead || '') + src + `\nmodule.exports={${exportNames.join(',')}};`)(mod);
  return mod.exports;
}
const C = load('src/data/mockHistoricalDemand.js',
  ['categories', 'zones', 'baseDemand', 'dayMultipliers', 'zoneWeights', 'festivals']);
const head = 'const mockBookings=[];'
  + `const categories=${JSON.stringify(C.categories)};`
  + `const zones=${JSON.stringify(C.zones)};`
  + `const baseDemand=${JSON.stringify(C.baseDemand)};`
  + `const dayMultipliers=${JSON.stringify(C.dayMultipliers)};`
  + `const zoneWeights=${JSON.stringify(C.zoneWeights)};`
  + `const festivals=${JSON.stringify(C.festivals)};`;
const D = load('src/data/demandHistory.js', ['syntheticDay'], head);
const dates = process.argv.slice(2);
console.log(JSON.stringify(dates.map((d) => D.syntheticDay(d))));
"""


def run_js(dates: list[str]) -> list[dict]:
    harness = REPO_ROOT / "ml" / ".parity_harness.js"
    harness.write_text(JS_HARNESS, encoding="utf-8")
    try:
        proc = subprocess.run(
            ["node", str(harness), *dates],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=180,
        )
        if proc.returncode != 0:
            print("JS harness failed:\n" + proc.stderr[-2000:])
            sys.exit(1)
        return json.loads(proc.stdout.strip().splitlines()[-1])
    finally:
        harness.unlink(missing_ok=True)


def main() -> int:
    js_days = run_js(SAMPLE_DATES)
    failures = 0

    for date_str, js_day in zip(SAMPLE_DATES, js_days):
        py_day = synthetic_day(date_str)

        checks = [("weather", py_day["weather"], js_day["weather"]),
                  ("dayOfWeek", py_day["day_of_week"], js_day["dayOfWeek"]),
                  ("festival", py_day["festival"], js_day["festival"]),
                  ("total", py_day["total"], js_day["total"])]
        for cat in CATEGORIES:
            checks.append((f"cat.{cat}", py_day["categories"][cat], js_day["categories"][cat]))
        for zone in ZONES:
            checks.append((f"zone.{zone}", py_day["zones"][zone], js_day["zones"][zone]))

        bad = [(name, p, j) for name, p, j in checks if p != j]
        if bad:
            failures += 1
            print(f"MISMATCH {date_str}")
            for name, p, j in bad[:6]:
                print(f"    {name}: python={p} js={j}")
        else:
            fest = py_day["festival"] or "-"
            print(f"ok       {date_str}  weather={py_day['weather']:<5} total={py_day['total']:<4} festival={fest}")

    print()
    if failures:
        print(f"FAILED — {failures}/{len(SAMPLE_DATES)} dates disagree.")
        print("The Python generator and demandHistory.js have drifted. Training on this data would")
        print("produce metrics that do not apply to what the app actually scores.")
        return 1

    print(f"PASSED — all {len(SAMPLE_DATES)} sampled dates identical in Python and JavaScript.")
    return 0


if __name__ == "__main__":
    sys.exit(main())


def _unused_today() -> date:  # pragma: no cover - kept for interactive use
    return date.today()
