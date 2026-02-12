"""
A/B Testing Middleware Infrastructure for Aiden OAuth Server

Provides three middleware functions:
1. ab_test_assign  - Assigns a consistent variation to each user per test
2. ab_test_log     - Logs that a user was shown a particular variation
3. event_logger    - Logs when a target action (e.g. button click) occurs

Usage in the request handler:
    # In do_GET / do_POST, before routing:
    ab_test_assign(self)   # sets self.ab_assignments
    ab_test_log(self)      # records exposure to the variation

    # When a target event endpoint is hit:
    event_logger(self, event_name="reply_button_click")
"""

import json
import hashlib
import time
import threading
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TESTS_FILE = Path(__file__).parent / "tests.json"
LOG_DIR = Path.home() / ".aiden" / "ab_tests"
ASSIGNMENTS_FILE = LOG_DIR / "assignments.json"
EXPOSURE_LOG_FILE = LOG_DIR / "exposures.jsonl"
EVENT_LOG_FILE = LOG_DIR / "events.jsonl"

# In-memory caches (thread-safe via locks)
_tests_cache = None
_tests_cache_mtime = 0
_tests_lock = threading.Lock()

_assignments_cache = {}
_assignments_lock = threading.Lock()

_jsonl_lock = threading.Lock()

_user_id_cache = None
_user_id_cache_time = 0
_user_id_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_tests():
    """Load and cache active tests from tests.json.

    Re-reads the file only when it has been modified on disk.
    """
    global _tests_cache, _tests_cache_mtime

    with _tests_lock:
        try:
            mtime = TESTS_FILE.stat().st_mtime
        except FileNotFoundError:
            _tests_cache = []
            return _tests_cache

        if _tests_cache is not None and mtime == _tests_cache_mtime:
            return _tests_cache

        with open(TESTS_FILE, "r") as f:
            data = json.load(f)

        _tests_cache = [t for t in data.get("tests", []) if t.get("active")]
        _tests_cache_mtime = mtime
        return _tests_cache


def _load_assignments():
    """Load persisted user-test assignments from disk."""
    global _assignments_cache

    with _assignments_lock:
        if _assignments_cache:
            return _assignments_cache

        if ASSIGNMENTS_FILE.exists():
            with open(ASSIGNMENTS_FILE, "r") as f:
                _assignments_cache = json.load(f)
        return _assignments_cache


def _save_assignments():
    """Persist current assignments to disk."""
    with _assignments_lock:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(ASSIGNMENTS_FILE, "w") as f:
            json.dump(_assignments_cache, f, indent=2)


def _get_user_id(handler):
    """Extract a stable user identifier from the request handler.

    Uses the user_info.json file (written at OAuth login) which contains the
    user's Google email.  Falls back to 'anonymous' if unavailable.

    Caches the result for 60 seconds to avoid reading the file on every request.
    """
    global _user_id_cache, _user_id_cache_time

    with _user_id_lock:
        now = time.time()
        if _user_id_cache is not None and (now - _user_id_cache_time) < 60:
            return _user_id_cache

        user_info_file = Path.home() / ".aiden" / "user_info.json"
        user_id = "anonymous"
        try:
            if user_info_file.exists():
                with open(user_info_file, "r") as f:
                    info = json.load(f)
                    user_id = info.get("email", "anonymous")
        except Exception:
            pass

        _user_id_cache = user_id
        _user_id_cache_time = now
        return user_id


def _deterministic_variation(user_id, test_id, variations):
    """Return a deterministic variation for a user + test combination.

    Uses SHA-256 hashing so the same user always gets the same bucket
    without needing to store state first.
    """
    digest = hashlib.sha256(f"{user_id}:{test_id}".encode()).hexdigest()
    index = int(digest, 16) % len(variations)
    return variations[index]


def _append_jsonl(filepath, record):
    """Append a JSON record as a single line to a .jsonl log file.

    Uses a lock to prevent interleaved writes from concurrent threads.
    """
    line = json.dumps(record) + "\n"
    with _jsonl_lock:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(filepath, "a") as f:
            f.write(line)


# ---------------------------------------------------------------------------
# Middleware 1 – Assignment
# ---------------------------------------------------------------------------

def ab_test_assign(handler):
    """Assign A/B test variations to the current user.

    For every active test whose ``routes`` list matches the current request
    path, the user is deterministically assigned a variation.  The assignment
    is persisted so that the same user always sees the same variation.

    After this function runs, ``handler.ab_assignments`` is a dict mapping
    test IDs to assigned variation strings (e.g. ``{"email_reply_button": "A"}``).
    """
    tests = _load_tests()
    assignments = _load_assignments()
    user_id = _get_user_id(handler)
    request_path = handler.path.split("?")[0]

    handler.ab_assignments = {}
    changed = False

    for test in tests:
        # Check if this test applies to the current route
        matched = any(request_path.startswith(route) for route in test.get("routes", []))
        if not matched:
            continue

        test_id = test["id"]
        key = f"{user_id}:{test_id}"

        if key in assignments:
            variation = assignments[key]
        else:
            variation = _deterministic_variation(
                user_id, test_id, test["variations"]
            )
            with _assignments_lock:
                _assignments_cache[key] = variation
            changed = True

        handler.ab_assignments[test_id] = variation

    if changed:
        _save_assignments()


# ---------------------------------------------------------------------------
# Middleware 2 – Exposure Logging
# ---------------------------------------------------------------------------

def ab_test_log(handler):
    """Log that the user was exposed to their assigned variations.

    Must be called *after* ``ab_test_assign`` so that
    ``handler.ab_assignments`` is populated.

    Each exposure is appended to a JSONL log file with the timestamp, user
    identifier, test ID, variation, and request path.
    """
    if not getattr(handler, "ab_assignments", None):
        return

    user_id = _get_user_id(handler)
    request_path = handler.path.split("?")[0]
    timestamp = time.time()

    for test_id, variation in handler.ab_assignments.items():
        record = {
            "timestamp": timestamp,
            "user_id": user_id,
            "test_id": test_id,
            "variation": variation,
            "path": request_path,
        }
        _append_jsonl(EXPOSURE_LOG_FILE, record)


# ---------------------------------------------------------------------------
# Middleware 3 – Event Logger
# ---------------------------------------------------------------------------

def event_logger(handler, event_name, metadata=None):
    """Log a target action performed by the user.

    Call this from specific endpoint handlers when the desirable action
    occurs (e.g. the user clicks the reply button).

    Parameters
    ----------
    handler : OAuthHandler
        The current request handler (used to read user id and assignments).
    event_name : str
        The name of the event (should match a ``target_event`` in tests.json).
    metadata : dict, optional
        Any additional data to attach to the log entry.
    """
    user_id = _get_user_id(handler)
    assignments = getattr(handler, "ab_assignments", {})

    record = {
        "timestamp": time.time(),
        "user_id": user_id,
        "event": event_name,
        "ab_assignments": assignments,
        "metadata": metadata or {},
    }
    _append_jsonl(EVENT_LOG_FILE, record)
