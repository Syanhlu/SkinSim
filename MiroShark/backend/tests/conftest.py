"""Shared pytest fixtures + markers for MiroShark.

Layout::

    backend/tests/
        conftest.py              ← this file: fixtures + skip logic
        test_unit_*.py           ← fast offline tests (run on every commit)
        test_integration_*.py    ← hit a live backend at $MIROSHARK_API_URL
                                   (opt in with `pytest -m integration`)

Existing hand-run scripts in ``backend/scripts/test_*.py`` stay as-is so
operators can still invoke them directly; the integration tests here wrap
them and register them for discovery.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

import pytest


# Make ``import app`` / ``import scripts`` work regardless of where pytest
# is invoked from. Repo layout: ``backend/{app,scripts,tests}``.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_SCRIPTS_DIR = _BACKEND_DIR / "scripts"
for p in (_BACKEND_DIR, _SCRIPTS_DIR):
    sp = str(p)
    if sp not in sys.path:
        sys.path.insert(0, sp)


def pytest_configure(config):
    """Register custom markers so ``-m integration`` doesn't emit warnings."""
    config.addinivalue_line(
        "markers",
        "integration: requires a live MiroShark backend at MIROSHARK_API_URL "
        "(default http://localhost:5001). Opt in with `pytest -m integration`.",
    )
    config.addinivalue_line(
        "markers",
        "slow: long-running tests (multi-minute E2E simulations).",
    )
    config.addinivalue_line(
        "markers",
        "neo4j: requires a running Neo4j at $NEO4J_URI.",
    )


def pytest_collection_modifyitems(config, items):
    """Skip ``@pytest.mark.integration`` tests by default.

    Run them explicitly with ``pytest -m integration`` (or
    ``pytest -m "integration or not integration"`` for everything).
    """
    selected_marker = config.getoption("-m") or ""
    if "integration" in selected_marker:
        return  # user asked for integration — don't skip
    skip_marker = pytest.mark.skip(
        reason="integration test — run with `pytest -m integration`"
    )
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip_marker)


# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def _fast_fail_neo4j_when_down():
    """Make ``create_app()`` fail Neo4j init instantly when Neo4j is down.

    Unit tests are offline by contract, and ``create_app()`` already
    tolerates Neo4j being unavailable (it stores ``None`` and moves on).
    But *how fast* that failure surfaces is platform-dependent: on Linux
    CI a refused Bolt connection errors in milliseconds, while on Windows
    each connect attempt burns seconds — and ``Neo4jStorage._ensure_schema``
    retries ~16 schema queries × 5 attempts, so a single ``create_app()``
    can hang for minutes and the "fast offline suite" stops being fast.

    This guard probes the configured Bolt port once (1.5s budget). If it's
    open, nothing is patched — tests see the exact production behavior.
    If it's closed, ``Neo4jStorage.__init__`` is replaced for the session
    with an immediate ``ConnectionError``, which is precisely the fast
    failure CI experiences.
    """
    import socket
    from urllib.parse import urlparse

    from app.config import Config

    uri = Config.NEO4J_URI or "bolt://localhost:7687"
    if "://" not in uri:
        uri = "bolt://" + uri
    parsed = urlparse(uri)
    host = parsed.hostname or "localhost"
    port = parsed.port or 7687

    try:
        probe = socket.create_connection((host, port), timeout=1.5)
        probe.close()
        yield  # Neo4j reachable — leave everything untouched.
        return
    except OSError:
        pass

    from app.storage import neo4j_storage as _n4j_mod

    original_init = _n4j_mod.Neo4jStorage.__init__

    def _refuse_immediately(self, *args, **kwargs):
        raise ConnectionError(
            f"Neo4j at {host}:{port} is unreachable — unit-test fast-fail "
            "guard (see tests/conftest.py)"
        )

    _n4j_mod.Neo4jStorage.__init__ = _refuse_immediately
    try:
        yield
    finally:
        _n4j_mod.Neo4jStorage.__init__ = original_init


@pytest.fixture(scope="session")
def api_base_url() -> str:
    """Base URL for the running MiroShark backend under test."""
    return os.environ.get("MIROSHARK_API_URL", "http://localhost:5001").rstrip("/")


@pytest.fixture(scope="session")
def live_backend(api_base_url: str) -> str:
    """Assert the backend is reachable before running integration tests.

    Skips the test (rather than failing) when /health is unreachable so CI
    without infra can still succeed on the unit suite.
    """
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(f"{api_base_url}/health", timeout=3) as r:
            if r.status != 200:
                pytest.skip(f"backend /health returned {r.status}")
    except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
        pytest.skip(f"no backend at {api_base_url}: {e}")
    return api_base_url


@pytest.fixture(scope="session")
def sample_simulation_id() -> Optional[str]:
    """Opt-in: reuse an existing simulation id from $MIROSHARK_TEST_SIM_ID.

    Many integration tests need a simulation_id to exercise endpoints like
    /frame and /publish. Setting ``MIROSHARK_TEST_SIM_ID=sim_xxx`` lets the
    suite skip the expensive "run a full simulation" step.
    """
    sid = os.environ.get("MIROSHARK_TEST_SIM_ID") or None
    if not sid:
        pytest.skip("set MIROSHARK_TEST_SIM_ID=sim_xxx to run this test")
    return sid
