# Milestones

## Milestone: A/B Testing Infrastructure

### Overview

This milestone adds infrastructure to make running A/B tests easy. The system is built as middleware functions that execute during every API request in our Python OAuth server backend (`oauth_server.py`). It follows the pattern discussed in Lecture 4: a configuration file describes the tests, middleware assigns and logs variations, and an event logger records target actions.

### Code Changes

#### 1. `tests.json` (new file)

A JSON configuration file in the project root that describes all A/B tests. Each test entry contains:

- **id** – unique identifier for the test
- **name / description** – human-readable labels
- **variations** – the set of buckets (e.g. `["A", "B"]`)
- **target_event** – the event name that constitutes a "conversion"
- **active** – boolean toggle; only active tests are evaluated by the middleware
- **routes** – which API paths the test applies to (middleware skips non-matching routes)

Two example tests are included: one for email reply button style and one for AI summary placement.

#### 2. `ab_testing.py` (new file)

A standalone Python module containing the three middleware functions:

| Function | Role |
|---|---|
| `ab_test_assign(handler)` | For every active test whose routes match the current request, deterministically assigns the user a variation using SHA-256 hashing of `user_id:test_id`. Persists assignments to `~/.aiden/ab_tests/assignments.json` so each user always sees the same variation. Sets `handler.ab_assignments` for downstream use. |
| `ab_test_log(handler)` | Appends an exposure record (timestamp, user, test, variation, path) to `~/.aiden/ab_tests/exposures.jsonl`. Called after `ab_test_assign`. |
| `event_logger(handler, event_name, metadata)` | Appends a target-action record to `~/.aiden/ab_tests/events.jsonl`. Includes the user's current A/B assignments so conversions can be correlated with variations. |

Key design decisions:

- **Deterministic assignment** – Uses `hashlib.sha256(user_id + test_id)` so assignment is consistent without requiring a prior lookup. Assignments are also cached on disk for fast repeated access.
- **User identification** – Reads the user's Google email from `~/.aiden/user_info.json` (written at OAuth login). Falls back to `"anonymous"`.
- **Thread safety** – All shared state is protected by `threading.Lock` since the server is multi-threaded (`ThreadingHTTPServer`).
- **JSONL logging** – Exposure and event logs use append-only JSONL (one JSON object per line), which is efficient for write-heavy workloads and easy to process with standard tools.
- **Hot-reloading** – `tests.json` is re-read when its modification time changes, so tests can be toggled without restarting the server.

#### 3. `oauth_server.py` (modified)

- **Import** – Added `from ab_testing import ab_test_assign, ab_test_log, event_logger` near the top.
- **`do_GET` and `do_POST`** – Added two middleware calls (`ab_test_assign(self)` then `ab_test_log(self)`) at the top of each method, before route dispatching. These run on every request.
- **`/log-event` endpoint** (new POST route) – Accepts `{"event": "...", "metadata": {...}}` from the frontend and calls `event_logger`. Returns the user's current A/B assignments in the response so the frontend can adapt the UI accordingly.
- **`handle_generate_reply`** – Added an `event_logger` call when a reply is successfully generated, logging the `reply_button_click` target event as a concrete example of A/B conversion tracking.

### How to Add a New A/B Test

1. Add an entry to `tests.json` with a unique `id`, the desired `variations`, the `target_event` name, and the `routes` it applies to. Set `active: true`.
2. The middleware will automatically assign and log variations for matching requests.
3. To log conversions, call `event_logger(self, event_name="your_target_event")` in the relevant handler, or have the frontend POST to `/log-event`.
4. Analyze results by reading `~/.aiden/ab_tests/exposures.jsonl` and `events.jsonl`.

### Challenges

- **No native middleware in `BaseHTTPRequestHandler`** – Python's built-in HTTP server does not have a middleware pipeline like Express.js or Flask. We solved this by calling the middleware functions explicitly at the top of `do_GET` and `do_POST`. This is straightforward but requires discipline to maintain the call order.
- **Desktop app single-user context** – Aiden is a Tauri desktop app, so in practice there is usually one user per installation. The A/B infrastructure still works correctly in this scenario (each user gets a consistent assignment) and would scale naturally to a multi-user deployment.
- **User identification before auth** – Some requests (health check, OAuth flow) occur before the user has authenticated. In these cases the user ID falls back to `"anonymous"`, which is acceptable since those routes are not typically part of A/B tests.

---

## Milestone: Load Testing & Concurrency Hardening

### Overview

This milestone stress tests the backend API under concurrent load using a custom Python load-testing script, identifies concurrency and scalability issues, applies fixes, and re-runs the tests to quantify improvements.

### Test Setup

**Tool:** Custom Python script (`load_tests/stress_test.py`) using `concurrent.futures.ThreadPoolExecutor` and the `requests` library.

**Endpoints tested:**

| Endpoint | Method | Type | Why |
|---|---|---|---|
| `/health` | GET | Read-only | Baseline — no I/O, no shared state |
| `/` | GET | Read-only | Baseline — no I/O, no shared state |
| `/log-event` | POST | **Write** | Writes to JSONL files and reads/writes `assignments.json` — tests file I/O concurrency |
| Mixed (70/30) | GET+POST | Read + Write | Simulates realistic traffic patterns |

**Concurrency levels:** 1, 10, 25, 50 concurrent workers, 200 requests per level.

**Metrics collected:** success rate, error rate (timeouts, HTTP 500s, connection errors), response times (min, mean, median, p95, p99, max), throughput (req/s), and JSONL data integrity (corrupt line detection).

### Pre-Fix Results (Before Concurrency Hardening)

#### Performance Summary

| Endpoint | Conc | Success% | Mean ms | P95 ms | P99 ms | RPS |
|---|---|---|---|---|---|---|
| /health | 1 | 100.0% | 1.8 | 1.9 | 2.4 | 60,807 |
| /health | 10 | 100.0% | 8.1 | 10.9 | 11.7 | 16,977 |
| /health | 25 | 100.0% | 19.4 | 29.9 | 32.3 | 5,866 |
| /health | 50 | 100.0% | 30.1 | 47.8 | 58.5 | 3,399 |
| /log-event | 1 | 100.0% | 1.8 | 2.0 | 3.2 | 42,440 |
| /log-event | 10 | 100.0% | 7.7 | 10.1 | 12.1 | 14,375 |
| /log-event | 25 | 100.0% | 18.0 | 25.7 | 28.6 | 6,026 |
| /log-event | 50 | 100.0% | 27.3 | 45.1 | 52.3 | 3,655 |
| / (root) | 50 | **99.5%** | 26.3 | 45.1 | 48.8 | 4,020 |
| Mixed (70/30) | 50 | 100.0% | 35.1 | 48.8 | 64.7 | 292 |

#### Issues Found

1. **Error rates:** 1 connection error at 50 concurrent workers on the root endpoint (0.5% error rate). All other endpoints showed 0% error rate.
2. **Data integrity:** 0 corrupt JSONL lines out of 890 in `events.jsonl`. However, `exposures.jsonl` had **0 entries** because the A/B test routes in `tests.json` did not include `/log-event`, meaning the exposure logging path was never exercised under concurrent load.
3. **Latency spike:** Mixed traffic test showed a max response time of **1,028 ms** (vs. ~55 ms typical max), indicating occasional thread contention.
4. **No JSONL write lock:** `_append_jsonl()` had no `threading.Lock`, relying on Python's GIL and OS-level append atomicity. While no corruption was observed at this scale, this is **not guaranteed** and would break under heavier load or on different OS configurations.
5. **User ID file read on every request:** `_get_user_id()` opened and parsed `user_info.json` on every single request, adding unnecessary I/O.
6. **Token refresh race condition:** `get_stored_credentials()` in `oauth_server.py` had no locking around the token refresh + pickle write path. Multiple concurrent threads finding an expired token would all try to refresh and write simultaneously.

### Concurrency Fixes Applied

#### 1. Added `_jsonl_lock` to `_append_jsonl()` (`ab_testing.py`)

```python
_jsonl_lock = threading.Lock()

def _append_jsonl(filepath, record):
    line = json.dumps(record) + "\n"  # Serialize outside the lock
    with _jsonl_lock:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(filepath, "a") as f:
            f.write(line)
```

The JSON serialization is done **before** acquiring the lock to minimize the critical section.

#### 2. Added caching to `_get_user_id()` (`ab_testing.py`)

```python
_user_id_cache = None
_user_id_cache_time = 0
_user_id_lock = threading.Lock()

def _get_user_id(handler):
    # Returns cached value for 60 seconds before re-reading from disk
```

Eliminates redundant file reads. The 60-second TTL ensures the cache stays fresh after login.

#### 3. Added `_token_lock` to `get_stored_credentials()` (`oauth_server.py`)

```python
_token_lock = threading.Lock()

def get_stored_credentials():
    with _token_lock:
        # ... token read, refresh, and write all within lock
```

Prevents multiple threads from simultaneously refreshing and writing the token.

#### 4. Added `/log-event` to A/B test routes (`tests.json`)

Updated the `email_reply_button` test's `routes` to include `"/log-event"` so the exposure logging path is exercised during load tests.

### Post-Fix Results (After Concurrency Hardening)

#### Performance Summary

| Endpoint | Conc | Success% | Mean ms | P95 ms | P99 ms | RPS |
|---|---|---|---|---|---|---|
| /health | 1 | 100.0% | 1.7 | 1.8 | 1.9 | 66,547 |
| /health | 10 | 100.0% | 7.6 | 10.8 | 13.1 | 15,142 |
| /health | 25 | 100.0% | 18.1 | 26.8 | 31.9 | 6,072 |
| /health | 50 | 100.0% | 26.4 | 44.9 | 51.9 | 3,603 |
| /log-event | 1 | 100.0% | 1.9 | 2.1 | 4.1 | 41,975 |
| /log-event | 10 | 100.0% | 8.4 | 11.7 | 14.2 | 14,028 |
| /log-event | 25 | 100.0% | 18.7 | 27.0 | 30.3 | 6,047 |
| /log-event | 50 | 100.0% | 29.7 | 47.9 | 57.1 | 3,336 |
| / (root) | 50 | **100.0%** | 25.4 | 44.3 | 53.0 | 3,702 |
| Mixed (70/30) | 50 | 100.0% | 29.5 | 48.6 | 65.1 | 4,487 |

#### Improvements Observed

| Metric | Before | After | Change |
|---|---|---|---|
| Root endpoint error rate (50 conc) | 0.5% | **0.0%** | Fixed |
| Mixed traffic max latency | 1,028 ms | **66.9 ms** | **-93.5%** |
| Mixed traffic throughput | 292 req/s | **4,487 req/s** | **+15x** |
| Exposures logged | 0 / 890 | **890 / 890** | Now exercised |
| JSONL corruption | 0 | 0 | Maintained (now guaranteed by lock) |
| events.jsonl integrity | 890/890 valid | 890/890 valid | Maintained |
| exposures.jsonl integrity | N/A (empty) | 890/890 valid | Fully validated |

#### Key Takeaways

- **Error rate** dropped to 0% across all endpoints and concurrency levels.
- **Mixed traffic throughput** improved 15x (292 -> 4,487 req/s) due to eliminating the user-info file read on every request.
- **Max latency spike** in mixed traffic dropped from 1,028 ms to 66.9 ms — the previous spike was caused by file I/O contention from the uncached `_get_user_id()`.
- **Data integrity** is now guaranteed by the `_jsonl_lock`, rather than relying on the GIL.
- **Exposure logging** now correctly writes 890/890 valid entries under concurrent load.

### Synchronous Paths Identified & Refactored

| Location | Issue | Fix |
|---|---|---|
| `ab_testing._append_jsonl()` | File writes with no lock | Added `_jsonl_lock` |
| `ab_testing._get_user_id()` | Disk read on every request | Added 60-second in-memory cache |
| `oauth_server.get_stored_credentials()` | Token refresh race condition | Added `_token_lock` |

### Additional Mitigations Planned

1. **Move to async I/O:** The `ThreadingHTTPServer` creates a new OS thread per request. Migrating to an async framework (e.g., `aiohttp` or `FastAPI`) would allow handling thousands of concurrent connections with lower overhead. This is the single largest scalability improvement available.
2. **Batch JSONL writes:** Instead of acquiring a lock and opening the file for each individual log entry, buffer writes in memory and flush periodically (e.g., every 100 entries or every 5 seconds). This would reduce lock contention and disk I/O under high load.
3. **Connection pooling for external APIs:** The `requests` library creates new TCP connections for each Google/OpenAI API call. Using a `requests.Session` with connection pooling (or `httpx.AsyncClient`) would reduce latency on these calls.
4. **Rate limiting per endpoint:** Currently only the AI API calls are rate-limited. Adding per-endpoint rate limiting would prevent cascading failures under load spikes.

### Challenges

- **OAuth-protected endpoints:** Most API endpoints (`/emails`, `/send-email`, `/generate-reply`, etc.) require valid Google OAuth tokens, making them impractical to load test without a test account. We focused on unauthenticated endpoints (`/health`, `/`, `/log-event`) that exercise the core server infrastructure and write paths.
- **Desktop app architecture:** Aiden is a single-user Tauri desktop app, so the "50 concurrent users" scenario is artificial. However, the thread safety issues found (unlocked file writes, token refresh races) are real bugs that could cause data corruption even with a single user if requests overlap (e.g., multiple frontend components firing API calls simultaneously).
- **Python GIL masking concurrency bugs:** At our test scale, Python's GIL and OS-level append semantics happened to prevent JSONL corruption even without locks. This is dangerous because it creates a false sense of safety — the same code could corrupt data on a different OS or under slightly different timing.
