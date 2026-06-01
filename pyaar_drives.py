"""Resolve V1/V3 drive roots without hardcoding.

Lookup order:
  1. Env var (PYAAR_V1_ROOT / PYAAR_V3_ROOT)
  2. ~/.config/pyaar-sync/drives.json
  3. Raise (with instructions)

Usage:
    from pyaar_drives import get_root, get_root_optional
    v3 = get_root("v3")              # raises if not found / not mounted
    v1 = get_root_optional("v1")     # returns None if missing (for no-op sync)
"""
import json
import os
from pathlib import Path

CONFIG_PATH = Path.home() / ".config/pyaar-sync/drives.json"


def _resolve(role: str) -> Path:
    role = role.lower()
    if role not in {"v1", "v3"}:
        raise ValueError(f"role must be 'v1' or 'v3', got {role!r}")
    env_key = f"PYAAR_{role.upper()}_ROOT"
    if env_key in os.environ and os.environ[env_key]:
        return Path(os.environ[env_key])
    if CONFIG_PATH.exists():
        cfg = json.loads(CONFIG_PATH.read_text())
        key = f"{role}_root"
        if key in cfg and cfg[key]:
            return Path(cfg[key])
    raise RuntimeError(
        f"Cannot resolve {role.upper()} root. Set {env_key} env var or "
        f"add '{role}_root' to {CONFIG_PATH}"
    )


def get_root(role: str) -> Path:
    """Return Path to V1 or V3 root. Raises if not configured or not mounted."""
    p = _resolve(role)
    if not p.exists():
        raise FileNotFoundError(
            f"{role.upper()} root configured as {p} but not mounted/accessible"
        )
    return p


def get_root_optional(role: str) -> Path | None:
    """Return Path to V1 or V3 root, or None if not configured or not mounted.

    Use this in sync scripts that should silently no-op when a drive is unplugged.
    """
    try:
        return get_root(role)
    except (RuntimeError, FileNotFoundError):
        return None


def get_write_root() -> tuple[Path, str]:
    """Return (path, role) of the preferred write target for new music.

    Prefers V3 (master). Falls back to V1 (staging) if V3 isn't mounted —
    both share the same internal folder structure, so V1 acts as a
    transparent fallback that gets uplifted to V3 on next reconnect via
    `uplift_to_v3.py`.

    Raises RuntimeError if neither drive is available.
    """
    v3 = get_root_optional("v3")
    if v3:
        return v3, "v3"
    v1 = get_root_optional("v1")
    if v1:
        return v1, "v1"
    raise RuntimeError(
        "Neither V3 nor V1 is mounted/configured. Plug in a drive or "
        "edit ~/.config/pyaar-sync/drives.json."
    )


if __name__ == "__main__":
    import sys
    for role in ("v1", "v3"):
        p = get_root_optional(role)
        status = "✓ mounted" if p else "✗ not mounted / not configured"
        print(f"{role.upper()}: {p}  ({status})")
    sys.exit(0)
