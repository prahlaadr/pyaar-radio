"""Resolve V1/V3 drive roots without hardcoding — works no matter how macOS
names/cases the volumes, and even survives a rename (marker file wins).

Canonical identities (user, 2026-10-01):
  v3 = the superset TB hard drive  (mounts as "vision 3.0", "vision 3", "V3", ...)
  v1 = the subset flash drive       (mounts as "VISION 1", "vision 1", "v1", ...)

Resolution order for each role:
  1. Env var  PYAAR_V1_ROOT / PYAAR_V3_ROOT  (full library path; wins if set)
  2. LIVE DISCOVERY of the mounted volume, then + library subpath:
       a. marker file  <volume>/.pyaar-drive  whose contents == "v1"/"v3"  (survives rename)
       b. volume-name regex  (vision 3 / v3 ; vision 1 / v1 ; case-insensitive)
       c. capacity tiebreak  (v3 is the big TB drive; v1 the small flash drive)
     The library subpath (v3: "music/RAAMI RADIO", v1: "DJ") comes from
     drives.json ({role}_subpath) and is applied only if it exists on the volume.
  3. drives.json cached {role}_root  (last known good)
  4. Raise.

Discovery results are cached back to drives.json so other tools reading the
json stay current (self-healing).

Usage:
    from pyaar_drives import get_root, get_root_optional, get_write_root
    v3 = get_root("v3")              # raises if not found / not mounted
    v1 = get_root_optional("v1")     # None if missing (for no-op sync)
"""
import json
import os
import re
import shutil
from pathlib import Path

CONFIG_PATH = Path.home() / ".config/pyaar-sync/drives.json"
VOLUMES = Path("/Volumes")
DEFAULT_SUBPATH = {"v3": "music/RAAMI RADIO", "v1": "DJ"}
NAME_RE = {
    "v3": re.compile(r"^v(ision)?[ _-]?3(\.0)?$", re.I),
    "v1": re.compile(r"^v(ision)?[ _-]?1$", re.I),
}
MARKER = ".pyaar-drive"


def _load_cfg() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception:
            return {}
    return {}


def _save_cfg(cfg: dict) -> None:
    try:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    except Exception:
        pass  # cache write is best-effort; never block resolution on it


def _volumes() -> list[Path]:
    try:
        return [v for v in VOLUMES.iterdir() if v.is_dir()]
    except Exception:
        return []


def _discover_volume(role: str) -> Path | None:
    vols = _volumes()
    # a. marker file wins (survives any rename)
    for v in vols:
        try:
            m = v / MARKER
            if m.is_file() and m.read_text(errors="replace").strip().lower() == role:
                return v
        except Exception:
            continue
    # b. volume-name regex
    named = [v for v in vols if NAME_RE[role].match(v.name)]
    if len(named) == 1:
        return named[0]
    # c. capacity tiebreak among candidates (or all vols if name was ambiguous)
    cands = named or [v for v in vols if v.name not in ("Macintosh HD",)]
    sized = []
    for v in cands:
        try:
            sized.append((shutil.disk_usage(v).total, v))
        except Exception:
            pass
    if sized:
        sized.sort(reverse=True)  # biggest first
        return sized[0][1] if role == "v3" else sized[-1][1]
    return None


def _subpath(role: str, cfg: dict) -> str:
    return cfg.get(f"{role}_subpath", DEFAULT_SUBPATH[role])


def _resolve(role: str) -> Path:
    role = role.lower()
    if role not in {"v1", "v3"}:
        raise ValueError(f"role must be 'v1' or 'v3', got {role!r}")
    env_key = f"PYAAR_{role.upper()}_ROOT"
    if os.environ.get(env_key):
        return Path(os.environ[env_key])

    cfg = _load_cfg()
    vol = _discover_volume(role)
    if vol is not None:
        sub = _subpath(role, cfg)
        root = vol / sub if (vol / sub).exists() else vol
        # self-heal the cache
        if cfg.get(f"{role}_root") != str(root):
            cfg[f"{role}_root"] = str(root)
            cfg.setdefault(f"{role}_subpath", DEFAULT_SUBPATH[role])
            _save_cfg(cfg)
        return root

    cached = cfg.get(f"{role}_root")
    if cached:
        return Path(cached)
    raise RuntimeError(
        f"Cannot resolve {role.upper()} root. Plug the drive in, or set {env_key}, "
        f"or add '{role}_root' to {CONFIG_PATH}."
    )


def get_root(role: str) -> Path:
    """Return Path to V1 or V3 library root. Raises if not configured/mounted."""
    p = _resolve(role)
    if not p.exists():
        raise FileNotFoundError(
            f"{role.upper()} root resolved to {p} but not mounted/accessible"
        )
    return p


def get_root_optional(role: str) -> Path | None:
    """Return Path to V1/V3 root, or None if not mounted (for no-op sync)."""
    try:
        return get_root(role)
    except (RuntimeError, FileNotFoundError):
        return None


def get_write_root() -> tuple[Path, str]:
    """(path, role) preferred write target: V3 (master) else V1 (staging)."""
    v3 = get_root_optional("v3")
    if v3:
        return v3, "v3"
    v1 = get_root_optional("v1")
    if v1:
        return v1, "v1"
    raise RuntimeError(
        "Neither V3 nor V1 is mounted. Plug in a drive "
        f"(or edit {CONFIG_PATH})."
    )


if __name__ == "__main__":
    for role in ("v3", "v1"):
        vol = _discover_volume(role)
        p = get_root_optional(role)
        how = "marker" if (vol and (vol / MARKER).is_file()) else ("name/size" if vol else "—")
        status = f"✓ {p}  (via {how})" if p else "✗ not mounted"
        print(f"{role.upper()}: {status}")
