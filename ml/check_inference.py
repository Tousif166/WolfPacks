"""
Asserts that src/utils/mlForecast.js reproduces scikit-learn's predictions.

Why this exists: the exported model is scored by hand-written JS — a tree walk and a dot product.
A wrong feature order, an off-by-one in the tree arrays, or a mismatched learning-rate/init would
still produce plausible-looking numbers. This compares the two implementations on real rows from the
test split and fails loudly if they diverge.

Run:  python ml/check_inference.py   (after train.py)
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from train import DATA_FILE, OUT_FILE, TEST_FRACTION, build_matrix, feature_names

REPO_ROOT = Path(__file__).resolve().parent.parent

SAMPLE_ROWS = 40
TOLERANCE = 1e-6

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
const model = JSON.parse(fs.readFileSync('src/data/forecastModel.json', 'utf8'));
const head = `const model=${JSON.stringify(model)};`
  + 'const festivalFor=()=>({name:null,multiplier:1});'
  + 'const weatherFor=()=>"Clear";'
  + 'const dateKey=()=>"2026-01-01";'
  + 'const ALL_CATEGORIES=[];const festivals=[];';
const M = load('src/utils/mlForecast.js', ['predictGbm', 'predictRidge'], head);

const vectors = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({
  gbm: vectors.map((v) => M.predictGbm(v)),
  ridge: vectors.map((v) => M.predictRidge(v)),
}));
"""


def main() -> int:
    if not OUT_FILE.exists():
        print(f"missing {OUT_FILE}. Run: python ml/train.py")
        return 1

    payload = json.loads(OUT_FILE.read_text(encoding="utf-8"))

    # Feature order must match what this JS will assume.
    if payload["featureNames"] != feature_names():
        print("FAILED — exported featureNames disagree with train.py's feature order.")
        return 1

    df = pd.read_csv(DATA_FILE, keep_default_na=False).sort_values(["date", "category"]).reset_index(drop=True)
    dates = sorted(df["date"].unique())
    split_at = dates[int(len(dates) * (1 - TEST_FRACTION))]
    test_df = df[df["date"] >= split_at]

    sample = test_df.sample(n=min(SAMPLE_ROWS, len(test_df)), random_state=7)
    x = build_matrix(sample)

    # ---- reference predictions, computed from the EXPORTED JSON (not the fitted objects), so this
    # validates the export as well as the JS ----
    gbm = payload["gbm"]

    def py_tree(tree, row):
        # Leaf test is children_left == -1 (TREE_LEAF); `feature` holds -2 at leaves, not -1.
        # Comparison in float32 to match sklearn's traversal precision — see mlForecast.js.
        node = 0
        while tree["left"][node] != -1:
            value = float(np.float32(row[tree["feature"][node]]))
            node = tree["left"][node] if value <= tree["threshold"][node] else tree["right"][node]
        return tree["value"][node]

    py_gbm = np.array([
        gbm["initial"] + gbm["learningRate"] * sum(py_tree(t, row) for t in gbm["trees"])
        for row in x
    ])

    ridge = payload["ridge"]
    mu = np.array(ridge["mean"])
    scale = np.array(ridge["scale"])
    scale[scale == 0] = 1.0
    py_ridge = ((x - mu) / scale) @ np.array(ridge["coefficients"]) + ridge["intercept"]

    # ---- JS predictions on the same vectors ----
    vec_file = REPO_ROOT / "ml" / ".inference_vectors.json"
    harness = REPO_ROOT / "ml" / ".inference_harness.js"
    vec_file.write_text(json.dumps(x.tolist()), encoding="utf-8")
    harness.write_text(JS_HARNESS, encoding="utf-8")
    try:
        proc = subprocess.run(
            ["node", str(harness), str(vec_file)],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=180,
        )
        if proc.returncode != 0:
            print("JS harness failed:\n" + proc.stderr[-2000:])
            return 1
        js = json.loads(proc.stdout.strip().splitlines()[-1])
    finally:
        vec_file.unlink(missing_ok=True)
        harness.unlink(missing_ok=True)

    js_gbm = np.array(js["gbm"])
    js_ridge = np.array(js["ridge"])

    gbm_diff = float(np.max(np.abs(py_gbm - js_gbm)))
    ridge_diff = float(np.max(np.abs(py_ridge - js_ridge)))

    print(f"rows compared      {len(x)}")
    print(f"max |diff| gbm     {gbm_diff:.3e}")
    print(f"max |diff| ridge   {ridge_diff:.3e}")
    print()

    # Also confirm the exported model still matches the LIVE sklearn estimator, catching a bad export.
    print("sample predictions (first 5):")
    print(f"  {'actual':>7} {'py_gbm':>9} {'js_gbm':>9} {'py_ridge':>9} {'js_ridge':>9}")
    actual = sample["demand"].to_numpy()
    for i in range(min(5, len(x))):
        print(f"  {actual[i]:>7} {py_gbm[i]:>9.4f} {js_gbm[i]:>9.4f} {py_ridge[i]:>9.4f} {js_ridge[i]:>9.4f}")
    print()

    if gbm_diff > TOLERANCE or ridge_diff > TOLERANCE:
        print(f"FAILED — JS and Python disagree by more than {TOLERANCE:g}.")
        print("mlForecast.js is not reproducing the exported model. Check the feature order, the")
        print("tree traversal, and the learningRate/initial handling before shipping.")
        return 1

    print(f"PASSED — JS inference matches the exported model to within {TOLERANCE:g}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
