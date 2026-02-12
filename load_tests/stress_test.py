#!/usr/bin/env python3
"""
Stress / Load Test Suite for Aiden OAuth Server

Tests the following under concurrent load:
  1. /health          – baseline read-only endpoint
  2. /log-event       – write endpoint (A/B test event logging)
  3. / (root)         – baseline read-only endpoint

Measures:
  - Response times (min, max, mean, median, p95, p99)
  - Throughput (requests/sec)
  - Error rates (timeouts, HTTP 500s, other errors)
  - Data integrity (JSONL corruption after concurrent writes)

Usage:
  python3 load_tests/stress_test.py [--base-url http://localhost:8081]
"""

import argparse
import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_BASE_URL = "http://localhost:8081"
CONCURRENCY_LEVELS = [1, 10, 25, 50]
REQUESTS_PER_LEVEL = 200  # total requests per concurrency level
TIMEOUT = 10  # seconds per request

AB_TEST_LOG_DIR = Path.home() / ".aiden" / "ab_tests"
EVENTS_FILE = AB_TEST_LOG_DIR / "events.jsonl"
EXPOSURES_FILE = AB_TEST_LOG_DIR / "exposures.jsonl"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_request(session, method, url, json_body=None):
    """Execute a single HTTP request and return timing + status info."""
    start = time.perf_counter()
    try:
        if method == "GET":
            resp = session.get(url, timeout=TIMEOUT)
        else:
            resp = session.post(url, json=json_body, timeout=TIMEOUT)
        elapsed = time.perf_counter() - start
        return {
            "status": resp.status_code,
            "elapsed": elapsed,
            "error": None,
            "body": resp.text[:500],
        }
    except requests.exceptions.Timeout:
        elapsed = time.perf_counter() - start
        return {"status": None, "elapsed": elapsed, "error": "timeout", "body": None}
    except requests.exceptions.ConnectionError as e:
        elapsed = time.perf_counter() - start
        return {"status": None, "elapsed": elapsed, "error": f"connection_error: {e}", "body": None}
    except Exception as e:
        elapsed = time.perf_counter() - start
        return {"status": None, "elapsed": elapsed, "error": str(e), "body": None}


def run_load_test(base_url, endpoint, method, concurrency, total_requests, json_body=None):
    """Run a load test against a single endpoint at a given concurrency level."""
    url = f"{base_url}{endpoint}"
    results = []

    with requests.Session() as session:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = []
            for _ in range(total_requests):
                futures.append(
                    pool.submit(make_request, session, method, url, json_body)
                )

            for future in as_completed(futures):
                results.append(future.result())

    return results


def analyze_results(results):
    """Compute summary statistics from a list of request results."""
    total = len(results)
    successes = [r for r in results if r["status"] == 200]
    errors_timeout = [r for r in results if r["error"] and "timeout" in str(r["error"])]
    errors_500 = [r for r in results if r["status"] and r["status"] >= 500]
    errors_conn = [r for r in results if r["error"] and "connection_error" in str(r["error"])]
    errors_other = [
        r for r in results
        if r not in successes and r not in errors_timeout
        and r not in errors_500 and r not in errors_conn
    ]

    times = [r["elapsed"] for r in results if r["elapsed"] is not None]
    success_times = [r["elapsed"] for r in successes]

    stats = {
        "total_requests": total,
        "successful": len(successes),
        "error_rate": (total - len(successes)) / total * 100 if total else 0,
        "timeouts": len(errors_timeout),
        "http_500s": len(errors_500),
        "connection_errors": len(errors_conn),
        "other_errors": len(errors_other),
    }

    if success_times:
        sorted_times = sorted(success_times)
        stats.update({
            "min_ms": sorted_times[0] * 1000,
            "max_ms": sorted_times[-1] * 1000,
            "mean_ms": statistics.mean(sorted_times) * 1000,
            "median_ms": statistics.median(sorted_times) * 1000,
            "p95_ms": sorted_times[int(len(sorted_times) * 0.95)] * 1000,
            "p99_ms": sorted_times[int(len(sorted_times) * 0.99)] * 1000,
        })

        total_time = max(times) if times else 1
        stats["throughput_rps"] = total / total_time
    else:
        stats.update({
            "min_ms": None, "max_ms": None, "mean_ms": None,
            "median_ms": None, "p95_ms": None, "p99_ms": None,
            "throughput_rps": 0,
        })

    return stats


def check_jsonl_integrity(filepath):
    """Check a JSONL file for corrupt lines (invalid JSON)."""
    if not filepath.exists():
        return {"exists": False, "total_lines": 0, "valid_lines": 0, "corrupt_lines": 0, "corrupt_examples": []}

    total = 0
    valid = 0
    corrupt = 0
    corrupt_examples = []

    with open(filepath, "r") as f:
        for i, line in enumerate(f, 1):
            total += 1
            line = line.strip()
            if not line:
                continue
            try:
                json.loads(line)
                valid += 1
            except json.JSONDecodeError:
                corrupt += 1
                if len(corrupt_examples) < 5:
                    corrupt_examples.append(f"Line {i}: {line[:200]}")

    return {
        "exists": True,
        "total_lines": total,
        "valid_lines": valid,
        "corrupt_lines": corrupt,
        "corrupt_examples": corrupt_examples,
    }


def print_header(text):
    print(f"\n{'='*70}")
    print(f"  {text}")
    print(f"{'='*70}")


def print_stats(stats, concurrency):
    print(f"\n  Concurrency: {concurrency} workers | {stats['total_requests']} requests")
    print(f"  ------------------------------------")
    print(f"  Successful:        {stats['successful']}/{stats['total_requests']}")
    print(f"  Error rate:        {stats['error_rate']:.1f}%")
    print(f"  Timeouts:          {stats['timeouts']}")
    print(f"  HTTP 500s:         {stats['http_500s']}")
    print(f"  Connection errors: {stats['connection_errors']}")
    if stats["mean_ms"] is not None:
        print(f"  Response times:")
        print(f"    Min:    {stats['min_ms']:.1f} ms")
        print(f"    Mean:   {stats['mean_ms']:.1f} ms")
        print(f"    Median: {stats['median_ms']:.1f} ms")
        print(f"    P95:    {stats['p95_ms']:.1f} ms")
        print(f"    P99:    {stats['p99_ms']:.1f} ms")
        print(f"    Max:    {stats['max_ms']:.1f} ms")
        print(f"  Throughput:        {stats['throughput_rps']:.1f} req/s")


# ---------------------------------------------------------------------------
# Main test runner
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Load test Aiden OAuth Server")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Server base URL")
    args = parser.parse_args()

    base_url = args.base_url
    all_results = {}

    # ------------------------------------------------------------------
    # Verify server is reachable
    # ------------------------------------------------------------------
    print(f"\nConnecting to {base_url} ...")
    try:
        r = requests.get(f"{base_url}/health", timeout=5)
        print(f"Server is up! (status {r.status_code})")
    except Exception as e:
        print(f"ERROR: Cannot reach server at {base_url}: {e}")
        sys.exit(1)

    # ------------------------------------------------------------------
    # Clean up old A/B test logs so we can measure integrity on fresh data
    # ------------------------------------------------------------------
    for f in [EVENTS_FILE, EXPOSURES_FILE]:
        if f.exists():
            f.unlink()
    print("Cleared old A/B test log files for clean integrity check.")

    # ==================================================================
    # TEST 1: GET /health (read-only baseline)
    # ==================================================================
    print_header("TEST 1: GET /health (read-only baseline)")
    all_results["health"] = {}
    for conc in CONCURRENCY_LEVELS:
        results = run_load_test(base_url, "/health", "GET", conc, REQUESTS_PER_LEVEL)
        stats = analyze_results(results)
        all_results["health"][conc] = stats
        print_stats(stats, conc)

    # ==================================================================
    # TEST 2: GET / (root endpoint baseline)
    # ==================================================================
    print_header("TEST 2: GET / (root endpoint baseline)")
    all_results["root"] = {}
    for conc in CONCURRENCY_LEVELS:
        results = run_load_test(base_url, "/", "GET", conc, REQUESTS_PER_LEVEL)
        stats = analyze_results(results)
        all_results["root"][conc] = stats
        print_stats(stats, conc)

    # ==================================================================
    # TEST 3: POST /log-event (write endpoint – A/B test event logging)
    # This is the critical concurrency test: multiple threads writing
    # to JSONL files and reading/writing assignments.json simultaneously.
    # ==================================================================
    print_header("TEST 3: POST /log-event (WRITE endpoint – concurrent file writes)")
    all_results["log_event"] = {}
    for conc in CONCURRENCY_LEVELS:
        event_body = {
            "event": f"stress_test_click_c{conc}",
            "metadata": {"concurrency": conc, "test_run": True},
        }
        results = run_load_test(
            base_url, "/log-event", "POST", conc, REQUESTS_PER_LEVEL,
            json_body=event_body,
        )
        stats = analyze_results(results)
        all_results["log_event"][conc] = stats
        print_stats(stats, conc)

    # ==================================================================
    # TEST 4: Mixed read + write (simulates realistic traffic)
    # 70% reads (/health) + 30% writes (/log-event) at high concurrency
    # ==================================================================
    print_header("TEST 4: Mixed traffic – 70% reads + 30% writes (50 workers)")
    mixed_results = []
    total_mixed = 300
    conc = 50

    with requests.Session() as session:
        with ThreadPoolExecutor(max_workers=conc) as pool:
            futures = []
            for i in range(total_mixed):
                if i % 10 < 7:
                    # 70% reads
                    futures.append(
                        pool.submit(make_request, session, "GET", f"{base_url}/health")
                    )
                else:
                    # 30% writes
                    body = {"event": "mixed_test_click", "metadata": {"index": i}}
                    futures.append(
                        pool.submit(make_request, session, "POST", f"{base_url}/log-event", body)
                    )
            for future in as_completed(futures):
                mixed_results.append(future.result())

    mixed_stats = analyze_results(mixed_results)
    all_results["mixed"] = {conc: mixed_stats}
    print_stats(mixed_stats, conc)

    # ==================================================================
    # DATA INTEGRITY CHECK
    # ==================================================================
    print_header("DATA INTEGRITY CHECK – JSONL files after concurrent writes")

    events_check = check_jsonl_integrity(EVENTS_FILE)
    exposures_check = check_jsonl_integrity(EXPOSURES_FILE)

    print(f"\n  events.jsonl:")
    print(f"    Total lines:   {events_check['total_lines']}")
    print(f"    Valid JSON:    {events_check['valid_lines']}")
    print(f"    Corrupt lines: {events_check['corrupt_lines']}")
    if events_check["corrupt_examples"]:
        print(f"    Examples of corruption:")
        for ex in events_check["corrupt_examples"]:
            print(f"      {ex}")

    print(f"\n  exposures.jsonl:")
    print(f"    Total lines:   {exposures_check['total_lines']}")
    print(f"    Valid JSON:    {exposures_check['valid_lines']}")
    print(f"    Corrupt lines: {exposures_check['corrupt_lines']}")
    if exposures_check["corrupt_examples"]:
        print(f"    Examples of corruption:")
        for ex in exposures_check["corrupt_examples"]:
            print(f"      {ex}")

    # Check expected event count vs actual
    # We sent: REQUESTS_PER_LEVEL * len(CONCURRENCY_LEVELS) + 30% of 300 = 800 + 90 = 890 events
    expected_events = (REQUESTS_PER_LEVEL * len(CONCURRENCY_LEVELS)) + int(total_mixed * 0.3)
    successful_log_events = sum(
        all_results["log_event"][c]["successful"] for c in CONCURRENCY_LEVELS
    ) + len([r for r in mixed_results if r["status"] == 200 and r not in []])

    print(f"\n  Expected event log entries:  ~{expected_events}")
    print(f"  Actual event log entries:    {events_check['total_lines']}")
    if events_check['total_lines'] < expected_events * 0.95:
        print(f"  WARNING: Possible data loss detected!")
    else:
        print(f"  OK: Event count within expected range.")

    # ==================================================================
    # SUMMARY
    # ==================================================================
    print_header("SUMMARY")

    # Build summary table
    print(f"\n  {'Endpoint':<20} {'Conc':>5} {'Success%':>9} {'Mean ms':>9} {'P95 ms':>9} {'P99 ms':>9} {'RPS':>8}")
    print(f"  {'-'*20} {'-'*5} {'-'*9} {'-'*9} {'-'*9} {'-'*9} {'-'*8}")

    for name, data in all_results.items():
        for conc, stats in data.items():
            success_pct = 100 - stats["error_rate"]
            mean = f"{stats['mean_ms']:.1f}" if stats['mean_ms'] else "N/A"
            p95 = f"{stats['p95_ms']:.1f}" if stats['p95_ms'] else "N/A"
            p99 = f"{stats['p99_ms']:.1f}" if stats['p99_ms'] else "N/A"
            rps = f"{stats['throughput_rps']:.0f}" if stats['throughput_rps'] else "N/A"
            print(f"  {name:<20} {conc:>5} {success_pct:>8.1f}% {mean:>9} {p95:>9} {p99:>9} {rps:>8}")

    print(f"\n  Data Integrity:")
    print(f"    events.jsonl     – {events_check['corrupt_lines']} corrupt / {events_check['total_lines']} total")
    print(f"    exposures.jsonl  – {exposures_check['corrupt_lines']} corrupt / {exposures_check['total_lines']} total")

    # Save full results to JSON
    results_file = Path(__file__).parent / "results.json"
    with open(results_file, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"\n  Full results saved to: {results_file}")

    integrity_file = Path(__file__).parent / "integrity_check.json"
    with open(integrity_file, "w") as f:
        json.dump({"events": events_check, "exposures": exposures_check}, f, indent=2)
    print(f"  Integrity report saved to: {integrity_file}")


if __name__ == "__main__":
    main()
