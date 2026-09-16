"""
Deterministic synthetic demand generator — a faithful port of src/data/demandHistory.js.

WHY IT IS A PORT AND NOT AN INDEPENDENT GENERATOR
The app scores the series produced by demandHistory.js. If this file invented its own distribution,
the model would be trained on one data-generating process and asked to predict another — classic
train/serve skew, and the reported metrics would be meaningless in the app. So the hash, the PRNG
and the per-day arithmetic are reproduced exactly, and check_parity.py asserts that Python and
JavaScript agree day by day.

CONSTANTS ARE DUPLICATED from src/data/mockHistoricalDemand.js. That is a real (if small) drift
risk: change them there and they must change here. The parity check is what catches it.

HONEST NOTE ON WHAT THIS DATA IS
These figures are synthetic. A model trained here learns the structure injected below — day-of-week
seasonality, weather sensitivity per trade, festival spikes, and +/-15% noise. Test error therefore
measures whether the fitting pipeline works, NOT whether the model knows anything true about real
demand in Kolkata. Do not present it as the latter.
"""

from __future__ import annotations

from datetime import date, timedelta

SEED_SALT = "sahakar-demand-v1"

CATEGORIES = [
    "plumbing",
    "electrical",
    "cleaning",
    "painting",
    "carpentry",
    "ac-repair",
    "pest-control",
    "appliance-repair",
]

ZONES = ["North", "South", "East", "West", "Central"]

BASE_DEMAND = {
    "plumbing": 18,
    "electrical": 22,
    "cleaning": 30,
    "painting": 8,
    "carpentry": 10,
    "ac-repair": 25,
    "pest-control": 12,
    "appliance-repair": 15,
}

# Index 0 == Sunday, matching JavaScript's Date.getDay().
DAY_MULTIPLIERS = [1.3, 0.8, 0.85, 0.9, 0.95, 1.0, 1.4]

ZONE_WEIGHTS = {"North": 0.22, "South": 0.28, "East": 0.15, "West": 0.18, "Central": 0.17}

WEATHER_KINDS = ["Clear", "Clear", "Clear", "Rainy", "Rainy", "Hot"]

FESTIVALS = [
    {"name": "Diwali", "date": "2026-10-20", "multiplier": 1.8,
     "categories": ["cleaning", "painting", "electrical"]},
    {"name": "Holi", "date": "2027-03-14", "multiplier": 1.5,
     "categories": ["cleaning", "painting"]},
    {"name": "Ganesh Chaturthi", "date": "2026-09-07", "multiplier": 1.4,
     "categories": ["cleaning", "electrical", "plumbing"]},
    {"name": "Navratri", "date": "2026-10-02", "multiplier": 1.3,
     "categories": ["cleaning", "painting"]},
]

_UINT32 = 0xFFFFFFFF


# ---------------------------------------------------------------------------
# JavaScript integer semantics
#
# Python ints are arbitrary precision, so every step that JS performs on 32-bit words has to be
# masked back down or the values diverge immediately.
# ---------------------------------------------------------------------------

def _to_int32(value: int) -> int:
    """JavaScript's `| 0` — reinterpret the low 32 bits as signed."""
    value &= _UINT32
    return value - 0x100000000 if value >= 0x80000000 else value


def _imul(a: int, b: int) -> int:
    """Math.imul — 32-bit multiply returning a signed 32-bit result."""
    return _to_int32((a * b) & _UINT32)


def _ushr(value: int, bits: int) -> int:
    """JavaScript's `>>>` — coerce to unsigned 32-bit, then shift."""
    return (value & _UINT32) >> bits


def hash_string(text: str) -> int:
    """FNV-1a, equivalent to the JS implementation in demandHistory.js."""
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = _imul(h, 16777619) & _UINT32
    return h & _UINT32


def _mulberry32(seed: int):
    """
    mulberry32, faithful to the JS original:
        a = (a + 0x6D2B79F5) | 0
        t = Math.imul(a ^ a >>> 15, 1 | a)
        t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    """
    state = seed & _UINT32

    def _next() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & _UINT32
        a = _to_int32(state)
        t = _imul(a ^ _ushr(a, 15), 1 | a)
        t = _to_int32(t + _imul(t ^ _ushr(t, 7), 61 | t)) ^ t
        return _ushr(t ^ _ushr(t, 14), 0) / 4294967296

    return _next


def _rng(seed_text: str):
    """Seeded PRNG for a namespaced key."""
    return _mulberry32(hash_string(seed_text))


# ---------------------------------------------------------------------------
# The generating process
# ---------------------------------------------------------------------------

def weather_for(date_str: str) -> str:
    rnd = _rng(f"{SEED_SALT}:weather:{date_str}")
    return WEATHER_KINDS[int(rnd() * len(WEATHER_KINDS))]


def weather_multiplier(weather: str, category: str) -> float:
    """How sensitive each trade is to the weather. Mirrors demandHistory.js."""
    if weather == "Rainy":
        if category in ("plumbing", "electrical"):
            return 1.4
        if category == "painting":
            return 0.4
        if category == "cleaning":
            return 0.75
        return 1.0
    if weather == "Hot":
        if category == "ac-repair":
            return 1.6
        if category == "pest-control":
            return 1.3
        if category == "painting":
            return 0.85
        return 1.0
    return 1.1 if category in ("painting", "carpentry") else 1.0


def festival_for(date_str: str, category: str):
    """
    Festival uplift for a trade on a date. Mirrors festivalFor() in demandHistory.js.

    RECURS ANNUALLY: the table holds one dated instance per festival, but these are yearly events,
    so only month/day are used and the nearest occurrence in the previous, current or next year is
    matched. Without this a multi-year history would contain a single Diwali and the festival
    features would carry almost no signal.

    Returns (name_or_None, multiplier).
    """
    target = date.fromisoformat(date_str)
    best = None

    for fest in FESTIVALS:
        if category not in fest["categories"]:
            continue
        fest_date = date.fromisoformat(fest["date"])
        for year in (target.year - 1, target.year, target.year + 1):
            try:
                occurrence = date(year, fest_date.month, fest_date.day)
            except ValueError:
                continue  # 29 Feb in a non-leap year
            diff_days = abs((occurrence - target).days)
            if diff_days <= 7 and (best is None or diff_days < best[1]):
                best = (fest["name"], diff_days, fest["multiplier"])

    if best is None:
        return None, 1.0
    name, diff_days, multiplier = best
    strength = max(1 - (diff_days / 10), 0.3)
    return name, 1 + (multiplier - 1) * strength


def js_day_of_week(day: date) -> int:
    """Python's weekday() is Mon=0; JavaScript's getDay() is Sun=0."""
    return (day.weekday() + 1) % 7


def synthetic_day(date_str: str) -> dict:
    """
    One day of baseline demand — a pure function of the date, identical to demandHistory.js.

    Note the PRNG is drawn in the same order as the JS version (all categories, then all zones),
    because changing the draw order changes every value downstream.
    """
    day = date.fromisoformat(date_str)
    day_of_week = js_day_of_week(day)
    day_mult = DAY_MULTIPLIERS[day_of_week]
    weather = weather_for(date_str)

    rnd = _rng(f"{SEED_SALT}:day:{date_str}")

    categories: dict[str, int] = {}
    total = 0
    festival_name = None
    for cat in CATEGORIES:
        noise = 0.85 + rnd() * 0.3
        # Festival uplift is deterministic, so applying it here does not disturb the PRNG draw order.
        fest_name, fest_mult = festival_for(date_str, cat)
        if fest_name:
            festival_name = fest_name
        value = max(0, _js_round(
            BASE_DEMAND[cat] * day_mult * weather_multiplier(weather, cat) * fest_mult * noise
        ))
        categories[cat] = value
        total += value

    zones: dict[str, int] = {}
    for zone in ZONES:
        zones[zone] = max(0, _js_round(total * ZONE_WEIGHTS[zone] * (0.9 + rnd() * 0.2)))

    return {
        "date": date_str,
        "day_of_week": day_of_week,
        "weather": weather,
        "categories": categories,
        "zones": zones,
        "total": total,
        "festival": festival_name,
    }


def _js_round(value: float) -> int:
    """
    Math.round semantics: halves go UP (towards +infinity), not to even.
    Python's built-in round() uses banker's rounding, which would disagree on exact .5 values.
    """
    import math
    return int(math.floor(value + 0.5))


def date_range(end: date, days: int) -> list[date]:
    """`days` consecutive dates ending on `end` inclusive."""
    return [end - timedelta(days=offset) for offset in range(days - 1, -1, -1)]
