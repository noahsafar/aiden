"""
ELO Ranking for GenAI Approaches
=================================

Tracks an ELO-style rating per approach ID. When a user prefers one
approach's output to another's, the winner's rating increases and the
loser's rating decreases according to the standard ELO update.

Persistence
-----------
Ratings live in ``~/.aiden/genai_eval/ratings.json`` (a single JSON object
mapping approach_id -> {rating, wins, losses, ties, exposures, updated_at}).
Every recorded preference is also appended to
``~/.aiden/genai_eval/preferences.jsonl`` for audit / re-computation.

Concurrency
-----------
A module-level lock guards both the in-memory cache and the on-disk JSON
file. The OAuth server is multi-threaded (ThreadingHTTPServer), so all
mutating operations must hold this lock.
"""

import json
import time
import threading
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

EVAL_DIR = Path.home() / ".aiden" / "genai_eval"
RATINGS_FILE = EVAL_DIR / "ratings.json"
PREFERENCES_FILE = EVAL_DIR / "preferences.jsonl"

INITIAL_RATING = 1200.0
K_FACTOR = 32.0  # Standard ELO K. Higher = ratings move faster per match.

_lock = threading.Lock()
_ratings_cache = None  # Lazy-loaded


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def _load_ratings_locked():
    """Read ratings.json into the cache. Caller must hold ``_lock``."""
    global _ratings_cache
    if _ratings_cache is not None:
        return _ratings_cache

    if RATINGS_FILE.exists():
        try:
            with open(RATINGS_FILE, "r") as f:
                _ratings_cache = json.load(f)
        except (json.JSONDecodeError, OSError):
            _ratings_cache = {}
    else:
        _ratings_cache = {}
    return _ratings_cache


def _save_ratings_locked():
    """Persist the ratings cache to disk. Caller must hold ``_lock``."""
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    with open(RATINGS_FILE, "w") as f:
        json.dump(_ratings_cache, f, indent=2)


def _ensure_entry_locked(approach_id):
    """Initialize a default entry for ``approach_id`` if missing."""
    if approach_id not in _ratings_cache:
        _ratings_cache[approach_id] = {
            "rating": INITIAL_RATING,
            "wins": 0,
            "losses": 0,
            "ties": 0,
            "exposures": 0,
            "updated_at": time.time(),
        }


def _append_preference(record):
    """Append a single preference record to the JSONL audit log."""
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    with open(PREFERENCES_FILE, "a") as f:
        f.write(json.dumps(record) + "\n")


# ---------------------------------------------------------------------------
# ELO math
# ---------------------------------------------------------------------------

def _expected(rating_a, rating_b):
    """Standard ELO expected-score formula for player A vs B."""
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def _apply_update(rating_a, rating_b, score_a):
    """Return updated (rating_a, rating_b) after a match.

    ``score_a`` is 1.0 for A wins, 0.0 for A loses, 0.5 for tie.
    """
    expected_a = _expected(rating_a, rating_b)
    expected_b = 1.0 - expected_a
    score_b = 1.0 - score_a

    new_a = rating_a + K_FACTOR * (score_a - expected_a)
    new_b = rating_b + K_FACTOR * (score_b - expected_b)
    return new_a, new_b


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_ratings():
    """Return a copy of the full ratings dict, sorted by rating desc."""
    with _lock:
        ratings = _load_ratings_locked()
        items = [
            {"approach_id": aid, **entry}
            for aid, entry in ratings.items()
        ]
        items.sort(key=lambda r: r["rating"], reverse=True)
        return items


def record_exposure(approach_ids):
    """Increment the exposure counter for one or more approaches.

    Called when an approach's output is shown to the user, regardless of
    whether they ultimately express a preference.
    """
    if not approach_ids:
        return
    with _lock:
        _load_ratings_locked()
        for aid in approach_ids:
            _ensure_entry_locked(aid)
            _ratings_cache[aid]["exposures"] += 1
            _ratings_cache[aid]["updated_at"] = time.time()
        _save_ratings_locked()


def record_preference(approach_a, approach_b, preferred, user_id=None, metadata=None):
    """Record a head-to-head preference and apply the ELO update.

    Parameters
    ----------
    approach_a, approach_b : str
        The two approach IDs that were shown to the user.
    preferred : str
        One of: ``approach_a``, ``approach_b``, or ``"tie"``.
    user_id : str, optional
        The user identifier (for audit / per-user analysis).
    metadata : dict, optional
        Extra context to record alongside the preference (e.g. subject).

    Returns
    -------
    dict
        ``{"before": {...}, "after": {...}, "expected_a": float}`` for the
        two approaches, suitable for returning in an API response.
    """
    if approach_a == approach_b:
        raise ValueError("Cannot record preference between identical approaches")
    if preferred not in (approach_a, approach_b, "tie"):
        raise ValueError(f"preferred must be one of {approach_a!r}, {approach_b!r}, or 'tie'")

    with _lock:
        ratings = _load_ratings_locked()
        _ensure_entry_locked(approach_a)
        _ensure_entry_locked(approach_b)

        before_a = ratings[approach_a]["rating"]
        before_b = ratings[approach_b]["rating"]

        if preferred == "tie":
            score_a = 0.5
            ratings[approach_a]["ties"] += 1
            ratings[approach_b]["ties"] += 1
        elif preferred == approach_a:
            score_a = 1.0
            ratings[approach_a]["wins"] += 1
            ratings[approach_b]["losses"] += 1
        else:
            score_a = 0.0
            ratings[approach_a]["losses"] += 1
            ratings[approach_b]["wins"] += 1

        new_a, new_b = _apply_update(before_a, before_b, score_a)

        ratings[approach_a]["rating"] = new_a
        ratings[approach_b]["rating"] = new_b
        ratings[approach_a]["updated_at"] = time.time()
        ratings[approach_b]["updated_at"] = time.time()

        _save_ratings_locked()

        result = {
            "approach_a": approach_a,
            "approach_b": approach_b,
            "preferred": preferred,
            "before": {approach_a: before_a, approach_b: before_b},
            "after": {approach_a: new_a, approach_b: new_b},
            "expected_a": _expected(before_a, before_b),
        }

    # Audit log (outside the lock - file append uses its own OS-level lock,
    # and we don't want to hold _lock during disk I/O for the audit append).
    _append_preference({
        "timestamp": time.time(),
        "user_id": user_id or "anonymous",
        **result,
        "metadata": metadata or {},
    })

    return result
