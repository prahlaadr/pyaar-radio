"""Radar health check: the entrypoint Pando taps into.

Reports the health of the radar as a *stem*: whether the deployed triage surface
(radio.pyaarproject.org/radar) is live, whether the committed radar-alerts.json is
in sync with what the site serves, when the weekly cloud scan last ran, and the
current alert breakdown. Pure stdlib (no duckdb/ytmusicapi/network creds) so it is
safe for an orchestrator to call on a schedule.

    python -m radar doctor          # human-readable report
    python -m radar doctor --json   # machine-readable for Pando

Two axes, deliberately separate:
  * cloud/parity  (what Pando monitors). Health = is the deployed site serving the
                    latest *committed* scan, and did the weekly scan succeed on time.
                    Parity is measured against the commit, NOT the local checkout.
  * capability    (local-only: browser.json / .venv / state.db + whether the local
                    checkout is current). Informational: state.db is gitignored and
                    CI rebuilds it each run, and a local checkout lags the scan
                    between git pulls by design, so neither drives health.
"""

import hashlib
import json
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

RADAR_DIR = Path(__file__).parent
PROJECT_DIR = RADAR_DIR.parent
ALERTS_PATH = PROJECT_DIR / "public" / "data" / "radar-alerts.json"
BROWSER_AUTH = PROJECT_DIR / "browser.json"
VENV = PROJECT_DIR / ".venv"
STATE_DB = RADAR_DIR / "state.db"

SITE = "https://radio.pyaarproject.org"
DEPLOYED_PAGE = f"{SITE}/radar"
DEPLOYED_ALERTS = f"{SITE}/data/radar-alerts.json"
REPO = "prahlaadr/pyaar-radio"
WORKFLOW = "radar-scan.yml"
CADENCE_DAYS = 7          # weekly scan
STALE_AFTER_DAYS = 9      # one cycle + a 2-day grace buffer


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _fetch(url: str, timeout: int = 15):
    """Return (http_status, body_bytes) or (None, None) on failure."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "radar-doctor"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except Exception:
        return None, None


def _last_scan() -> dict:
    """Latest completed radar-scan run via gh. Degrades gracefully if gh is absent."""
    try:
        out = subprocess.run(
            ["gh", "run", "list", "--workflow", WORKFLOW, "--repo", REPO,
             "--limit", "10", "--json", "status,conclusion,createdAt,databaseId"],
            capture_output=True, text=True, timeout=20,
        )
        if out.returncode != 0:
            return {"source": "gh", "available": False, "note": out.stderr.strip()[:120]}
        runs = json.loads(out.stdout or "[]")
        done = [r for r in runs if r.get("status") == "completed"]
        if not done:
            return {"source": "gh", "available": True, "note": "no completed runs"}
        latest = done[0]
        created = datetime.fromisoformat(latest["createdAt"].replace("Z", "+00:00"))
        age_days = (datetime.now(timezone.utc) - created).total_seconds() / 86400
        return {
            "source": "gh",
            "available": True,
            "conclusion": latest.get("conclusion"),
            "finished_at": latest["createdAt"],
            "age_days": round(age_days, 1),
            "cadence_days": CADENCE_DAYS,
            "stale": age_days > STALE_AFTER_DAYS,
            "run_id": latest.get("databaseId"),
        }
    except Exception as e:
        return {"source": "gh", "available": False, "note": f"{type(e).__name__}: {e}"[:120]}


def _committed_sha():
    """sha256 of radar-alerts.json at origin/main HEAD (the latest scan output), via gh.

    This is the canonical reference: the deployed site should serve this, and a local
    checkout is "current" when it matches this. None if gh is unavailable.
    """
    import base64
    try:
        out = subprocess.run(
            ["gh", "api", f"repos/{REPO}/contents/public/data/radar-alerts.json", "--jq", ".content"],
            capture_output=True, text=True, timeout=20,
        )
        if out.returncode != 0 or not out.stdout.strip():
            return None
        return _sha(base64.b64decode(out.stdout))  # b64decode discards the embedded newlines
    except Exception:
        return None


def _git_committed_at(path: Path):
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cI", "--", str(path)],
            cwd=str(PROJECT_DIR), capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() or None
    except Exception:
        return None


def _mtime(path: Path):
    try:
        return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    except Exception:
        return None


def collect() -> dict:
    checks = []
    warnings = []

    # --- cloud / parity axis ---
    page_http, _ = _fetch(DEPLOYED_PAGE)
    reachable = page_http == 200
    checks.append({"name": "deployed /radar reachable", "ok": reachable,
                   "detail": f"HTTP {page_http}" if page_http else "unreachable"})

    alerts_http, deployed_body = _fetch(DEPLOYED_ALERTS)
    deployed_sha = _sha(deployed_body) if deployed_body else None
    commit_sha = _committed_sha()  # latest scan output on origin/main
    local_body = ALERTS_PATH.read_bytes() if ALERTS_PATH.exists() else None
    local_sha = _sha(local_body) if local_body else None

    # Primary signal: is the LIVE site serving the latest committed scan?
    # Compared against the commit, NOT the local checkout: a local checkout lags
    # between manual git pulls by design, so it must never drive health (else the
    # monitor cries wolf after every weekly scan until someone pulls).
    if commit_sha and deployed_sha:
        serving_latest = deployed_sha == commit_sha
        serving_detail = ("serving latest scan" if serving_latest
                          else "live site behind latest scan (Vercel deploy lag or failed deploy)")
    elif not commit_sha:
        serving_latest = None
        serving_detail = "latest-commit sha unverifiable (gh unavailable)"
    else:
        serving_latest = None
        serving_detail = "deployed alerts fetch failed"
    checks.append({"name": "deployed serving latest scan", "ok": serving_latest is not False,
                   "detail": serving_detail})

    # Housekeeping note (never fails): is the local checkout current with the scan?
    ref_sha = commit_sha or deployed_sha
    local_current = bool(local_sha and ref_sha and local_sha == ref_sha)
    if local_sha and ref_sha and not local_current:
        warnings.append("local radar-alerts.json behind latest scan: `git pull` to refresh (live site unaffected)")

    # alert breakdown (prefer what the site actually serves; fall back to local)
    body_for_counts = deployed_body or local_body
    alerts_summary = {"total": 0, "by_status": {}, "by_verify": {}}
    if body_for_counts:
        try:
            data = json.loads(body_for_counts)
            alerts = data if isinstance(data, list) else data.get("alerts", [])
            by_status, by_verify = {}, {}
            for a in alerts:
                s = a.get("status") or "?"
                v = a.get("verify") or "unverified"
                by_status[s] = by_status.get(s, 0) + 1
                by_verify[v] = by_verify.get(v, 0) + 1
            alerts_summary = {"total": len(alerts), "by_status": by_status, "by_verify": by_verify}
        except Exception as e:
            warnings.append(f"could not parse radar-alerts.json: {e}")

    last = _last_scan()
    if last.get("available"):
        ok = last.get("conclusion") == "success" and not last.get("stale")
        checks.append({"name": "weekly cloud scan (radar-scan.yml)", "ok": ok,
                       "detail": f"{last.get('conclusion')}, {last.get('age_days')}d ago"
                                 + (", STALE" if last.get("stale") else "")})
    else:
        warnings.append(f"last-scan status unverifiable ({last.get('note', 'gh unavailable')})")

    # --- local capability axis (informational) ---
    capability = {
        "browser_json": {"present": BROWSER_AUTH.exists(), "mtime": _mtime(BROWSER_AUTH)},
        "venv": VENV.exists(),
        "state_db": {"present": STATE_DB.exists(), "mtime": _mtime(STATE_DB)},
    }
    if not capability["browser_json"]["present"]:
        warnings.append("browser.json missing: local scans won't authenticate (cloud unaffected)")
    if not capability["venv"]:
        warnings.append(".venv missing: `uv venv && uv pip install duckdb ytmusicapi` to run locally")

    # --- overall status (cloud axis only; capability + local-freshness are warnings) ---
    if not reachable:
        status = "down"
    elif alerts_http != 200 or serving_latest is False or last.get("stale") or last.get("conclusion") == "failure":
        status = "degraded"
    else:
        status = "ok"

    fresh = f"{last.get('age_days')}d ago" if last.get("available") else "unknown"
    live_state = ("serving latest scan" if serving_latest else
                  "BEHIND latest scan" if serving_latest is False else "reachable")
    summary = (f"{status.upper()}: deployed {'live' if reachable else 'DOWN'}, "
               f"{live_state}, {alerts_summary['total']} alerts, last scan {fresh}")

    return {
        "stem": "pando-radar",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "summary": summary,
        "deployed": {"page": DEPLOYED_PAGE, "page_http": page_http,
                     "alerts_http": alerts_http, "alerts_sha256": deployed_sha,
                     "serving_latest": serving_latest},
        "local": {"alerts_path": str(ALERTS_PATH.relative_to(PROJECT_DIR)),
                  "alerts_sha256": local_sha, "current": local_current,
                  "alerts_committed_at": _git_committed_at(ALERTS_PATH)},
        "parity": {"serving_latest": serving_latest, "local_current": local_current,
                   "commit_sha256": commit_sha},
        "alerts": alerts_summary,
        "last_scan": last,
        "capability": capability,
        "checks": checks,
        "warnings": warnings,
    }


def run_doctor(as_json: bool = False) -> dict:
    report = collect()
    if as_json:
        print(json.dumps(report, indent=2))
        return report

    icon = {"ok": "✓", "degraded": "⚠", "down": "✗"}[report["status"]]
    print(f"\n{icon} pando-radar: {report['status'].upper()}")
    print(f"  {report['summary']}\n")
    for c in report["checks"]:
        print(f"  {'✓' if c['ok'] else '✗'} {c['name']}: {c['detail']}")
    a = report["alerts"]
    print(f"\n  alerts: {a['total']}  status={a['by_status']}  verify={a['by_verify']}")
    cap = report["capability"]
    print(f"  local capability: browser.json={cap['browser_json']['present']} "
          f".venv={cap['venv']} state.db={cap['state_db']['present']} (informational)")
    if report["warnings"]:
        print("\n  warnings:")
        for w in report["warnings"]:
            print(f"    - {w}")
    print()
    return report
