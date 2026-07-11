"""Unit tests for the async A/B experiment surface (Phase 2 of the VNG plan).

Offline by design — no live backend, no Neo4j, no LLM, no heavy ML imports:

  1. Request validation on ``POST /api/experiments/ab-test`` plus the
     status/results/list routes, exercised through a bare Flask app with
     the blueprint mounted and the service mocked.
  2. State-machine transitions (`preparing → running → complete` and the
     failure path) on :class:`ABExperimentService` with every network-
     touching orchestration phase monkeypatched — asserts the status that
     was **persisted to disk** at each phase boundary, the single-worker
     409 conflict, and registry cleanup.
  3. Results-mapping math: a hand-computed fixture state pushed through
     ``build_results_payload`` and asserted field-for-field against the
     TS ``ExperimentResults`` contract (visitors = Σ agents across
     replicates, conversions = Σ bullish).
"""

from __future__ import annotations

import json
import sys
import threading
import time
from pathlib import Path

import pytest
from flask import Flask

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from app.services import ab_experiment_service as svc
from app.services.ab_experiment_service import (
    ABExperimentService,
    ExperimentConflictError,
    ExperimentNotCompleteError,
    build_initial_state,
    build_results_payload,
    compute_progress,
    save_state,
)


# ──────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def _isolated_service(tmp_path, monkeypatch):
    """Point the service at a temp dir and reset its in-process registry."""
    monkeypatch.setattr(ABExperimentService, "EXPERIMENTS_DIR", str(tmp_path / "experiments"))
    ABExperimentService._threads = {}
    ABExperimentService._active_id = None
    yield
    ABExperimentService._threads = {}
    ABExperimentService._active_id = None


@pytest.fixture()
def client():
    """Bare Flask app with just the experiments blueprint — no auth guard,
    no Neo4j, no other blueprints. Keeps the test genuinely offline."""
    from app.api import experiments_bp

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(experiments_bp, url_prefix="/api/experiments")
    with app.test_client() as test_client:
        yield test_client


def _valid_body(**overrides):
    body = {
        "hypothesis": "Variant B lifts positive stance",
        "scenario": "KFC Vietnam launches a new combo.",
        "variants": [
            {"name": "A", "text": "combo 89k"},
            {"name": "B", "text": "mua 1 tặng 1"},
        ],
        "replicates": 1,
        "parallel": 1,
    }
    body.update(overrides)
    return body


# ──────────────────────────────────────────────────────────────────────────
# 1. Request validation
# ──────────────────────────────────────────────────────────────────────────


def test_ab_test_rejects_non_json_body(client):
    res = client.post("/api/experiments/ab-test", data="not json")
    assert res.status_code == 400
    assert "error" in res.json


def test_ab_test_requires_hypothesis(client):
    res = client.post("/api/experiments/ab-test", json=_valid_body(hypothesis=""))
    assert res.status_code == 400
    assert "hypothesis" in res.json["error"]


def test_ab_test_requires_scenario_or_parent(client):
    body = _valid_body()
    del body["scenario"]
    res = client.post("/api/experiments/ab-test", json=body)
    assert res.status_code == 400
    assert "scenario" in res.json["error"]


def test_ab_test_rejects_both_scenario_and_parent(client):
    res = client.post(
        "/api/experiments/ab-test",
        json=_valid_body(parent_simulation_id="sim_123"),
    )
    assert res.status_code == 400
    assert "not both" in res.json["error"]


def test_ab_test_requires_two_variants(client):
    res = client.post(
        "/api/experiments/ab-test",
        json=_valid_body(variants=[{"name": "A", "text": "only one"}]),
    )
    assert res.status_code == 400
    assert "2 variants" in res.json["error"]


def test_ab_test_rejects_duplicate_variant_names(client):
    res = client.post(
        "/api/experiments/ab-test",
        json=_valid_body(
            variants=[
                {"name": "A", "text": "one"},
                {"name": "A", "text": "two"},
            ]
        ),
    )
    assert res.status_code == 400
    assert "duplicate" in res.json["error"]


def test_ab_test_rejects_bad_replicates(client):
    res = client.post("/api/experiments/ab-test", json=_valid_body(replicates=0))
    assert res.status_code == 400
    assert "replicates" in res.json["error"]


def test_ab_test_returns_202_and_job(client, monkeypatch):
    captured = {}

    def fake_create(cls, **kwargs):
        captured.update(kwargs)
        return {
            "experiment_id": "exp_test0001",
            "parent_simulation_id": None,
            "status": "preparing",
        }

    monkeypatch.setattr(ABExperimentService, "create_experiment", classmethod(fake_create))
    res = client.post("/api/experiments/ab-test", json=_valid_body())
    assert res.status_code == 202
    assert res.json == {
        "experiment_id": "exp_test0001",
        "parent_simulation_id": None,
        "status": "preparing",
    }
    assert captured["hypothesis"] == "Variant B lifts positive stance"
    assert captured["replicates"] == 1


def test_ab_test_conflict_maps_to_409(client, monkeypatch):
    def fake_create(cls, **kwargs):
        raise ExperimentConflictError("experiment exp_busy is already running")

    monkeypatch.setattr(ABExperimentService, "create_experiment", classmethod(fake_create))
    res = client.post("/api/experiments/ab-test", json=_valid_body())
    assert res.status_code == 409
    assert "already running" in res.json["error"]


def test_status_unknown_experiment_404(client):
    res = client.get("/api/experiments/exp_missing1/status")
    assert res.status_code == 404


def test_results_unknown_experiment_404(client):
    res = client.get("/api/experiments/exp_missing1/results")
    assert res.status_code == 404


def test_results_before_complete_409(client, monkeypatch):
    def fake_results(cls, experiment_id):
        raise ExperimentNotCompleteError("experiment is running, not complete")

    monkeypatch.setattr(ABExperimentService, "get_results", classmethod(fake_results))
    res = client.get("/api/experiments/exp_running1/results")
    assert res.status_code == 409
    assert "not complete" in res.json["error"]


def test_list_returns_experiments_array(client):
    res = client.get("/api/experiments/list")
    assert res.status_code == 200
    assert res.json == {"experiments": []}


# ──────────────────────────────────────────────────────────────────────────
# 2. State-machine transitions on a mocked service
# ──────────────────────────────────────────────────────────────────────────


def _mock_phases(monkeypatch, observed, fail_in=None):
    """Replace every network-touching phase with a recorder.

    Each recorder notes the status that was current (i.e. already
    persisted) when its phase started — proving the preparing → running
    transitions land on disk in order.
    """

    def fake_create_parent(client, state, out_dir, poll_interval):
        observed.append(("create_parent", state.get("status")))
        if fail_in == "create_parent":
            raise RuntimeError("ontology generation: boom")
        state["parent"]["simulation_id"] = "sim_parent01"
        state["parent"]["ready"] = True
        save_state(out_dir, state)

    def fake_run_branches(client, state, out_dir, parallel, poll_interval):
        observed.append(("run_branches", state.get("status")))
        for i, run in enumerate(state["runs"], start=1):
            run["simulation_id"] = f"sim_branch{i:02d}"
            run["phase"] = "terminal"
            run["status"] = "completed"
            run["terminal_status"] = "completed"
            run["last_status"] = {"current_round": 48, "total_rounds": 48}
        save_state(out_dir, state)

    def fake_fetch_metrics(client, state, out_dir):
        observed.append(("fetch_metrics", state.get("status")))
        for run in state["runs"]:
            run["final_bullish_pct"] = 50.0
            run["phase"] = "metrics_fetched"
        save_state(out_dir, state)

    monkeypatch.setattr(svc, "create_parent", fake_create_parent)
    monkeypatch.setattr(svc, "run_branches", fake_run_branches)
    monkeypatch.setattr(svc, "fetch_metrics", fake_fetch_metrics)


def _wait_for_terminal(experiment_id, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = ABExperimentService.get_status(experiment_id)
        if status and status["status"] in ("complete", "failed"):
            return status
        time.sleep(0.02)
    raise AssertionError("experiment did not reach a terminal status in time")


def test_experiment_runs_preparing_running_complete(monkeypatch):
    observed = []
    _mock_phases(monkeypatch, observed)

    job = ABExperimentService.create_experiment(
        hypothesis="B beats A",
        variants=[{"name": "A", "text": "a"}, {"name": "B", "text": "b"}],
        scenario="scenario text",
        replicates=2,
        parallel=2,
        poll_interval=1,
    )
    assert job["status"] == "preparing"
    assert job["experiment_id"].startswith("exp_")

    status = _wait_for_terminal(job["experiment_id"])
    assert status["status"] == "complete"
    assert status["error"] is None

    # Phase entry statuses prove the persisted transitions happened in order.
    assert observed == [
        ("create_parent", "preparing"),
        ("run_branches", "running"),
        ("fetch_metrics", "running"),
    ]

    # Disk is the source of truth: state.json carries the CLI schema + extras.
    state_path = (
        Path(ABExperimentService.EXPERIMENTS_DIR) / job["experiment_id"] / "state.json"
    )
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["status"] == "complete"
    assert state["hypothesis"] == "B beats A"
    assert state["schema_version"] == 1
    assert state["parent"]["simulation_id"] == "sim_parent01"
    assert state["progress"] == {
        "runs_total": 4,
        "runs_done": 4,
        "runs_active": 0,
        "current_round_max": 48,
        "rounds_per_run": 48,
    }

    # Artifacts written on completion.
    exp_dir = state_path.parent
    assert (exp_dir / "results.json").exists()
    assert (exp_dir / "report.md").exists()

    # Status payload mirrors the run list.
    assert len(status["runs"]) == 4
    assert status["runs"][0]["state"] == "completed"
    assert status["runs"][0]["rounds_done"] == 48
    assert status["parent_simulation_id"] == "sim_parent01"

    # Registry drained: nothing is "active" any more.
    assert ABExperimentService.get_active_experiment_id() is None

    # And the experiment shows up in the listing.
    listed = ABExperimentService.list_experiments()
    assert [e["experiment_id"] for e in listed] == [job["experiment_id"]]
    assert listed[0]["status"] == "complete"
    assert listed[0]["hypothesis"] == "B beats A"


def test_experiment_failure_is_persisted(monkeypatch):
    observed = []
    _mock_phases(monkeypatch, observed, fail_in="create_parent")

    job = ABExperimentService.create_experiment(
        hypothesis="doomed",
        variants=[{"name": "A", "text": "a"}, {"name": "B", "text": "b"}],
        scenario="scenario text",
        replicates=1,
    )
    status = _wait_for_terminal(job["experiment_id"])
    assert status["status"] == "failed"
    assert "boom" in status["error"]

    # Results are refused for a failed experiment.
    with pytest.raises(ExperimentNotCompleteError):
        ABExperimentService.get_results(job["experiment_id"])

    # The worker slot is free again after a failure.
    assert ABExperimentService.get_active_experiment_id() is None


def test_second_experiment_conflicts_while_first_active(monkeypatch):
    release = threading.Event()

    def blocking_run(cls, experiment_id):
        release.wait(timeout=10)

    monkeypatch.setattr(ABExperimentService, "_run_experiment", classmethod(blocking_run))

    first = ABExperimentService.create_experiment(
        hypothesis="first",
        variants=[{"name": "A", "text": "a"}, {"name": "B", "text": "b"}],
        scenario="s",
    )
    try:
        with pytest.raises(ExperimentConflictError):
            ABExperimentService.create_experiment(
                hypothesis="second",
                variants=[{"name": "A", "text": "a"}, {"name": "B", "text": "b"}],
                scenario="s",
            )
    finally:
        release.set()
        thread = ABExperimentService._threads.get(first["experiment_id"])
        if thread is not None:
            thread.join(timeout=10)

    # Once the worker exits, the slot frees up.
    assert ABExperimentService.get_active_experiment_id() is None


def test_create_experiment_validates_inputs():
    with pytest.raises(ValueError):
        ABExperimentService.create_experiment(
            hypothesis="h", variants=[{"name": "A", "text": "a"}], scenario="s"
        )
    with pytest.raises(ValueError):
        ABExperimentService.create_experiment(
            hypothesis="h",
            variants=[{"name": "A", "text": "a"}, {"name": "B", "text": "b"}],
        )


# ──────────────────────────────────────────────────────────────────────────
# 3. Results mapping — hand-computed fixture
# ──────────────────────────────────────────────────────────────────────────


def _completed_run(variant, replicate, sim_id, bullish_pct, agents, price_yes=None):
    metrics = {
        "demographics": {
            "success": True,
            "data": {"dimensions": {}, "meta": {"total_agents": agents + 5, "agents_with_stance": agents}},
        },
    }
    if price_yes is not None:
        metrics["polymarket_markets"] = {
            "success": True,
            "data": {"markets": [{"market_id": 1, "price_yes": price_yes}]},
        }
    return {
        "variant": variant,
        "replicate": replicate,
        "label": f"{variant} r{replicate}",
        "simulation_id": sim_id,
        "phase": "metrics_fetched",
        "status": "completed",
        "final_bullish_pct": bullish_pct,
        "metrics": metrics,
    }


def _fixture_state():
    state = build_initial_state(
        api_url="http://localhost:5001",
        out_dir="unused",
        variants=[{"name": "A", "text": "a"}, {"name": "B", "text": "b"}],
        replicates=2,
        parallel=2,
        trigger_round=0,
        poll_interval=30,
        scenario_text="s",
    )
    state["runs"] = [
        # Variant A: 100 agents @ 46% → 46 bullish; 100 agents @ 48% → 48.
        _completed_run("A", 1, "sim_a1", 46.0, 100, price_yes=0.44),
        _completed_run("A", 2, "sim_a2", 48.0, 100),
        # Variant B: 100 agents @ 56% → 56; 120 agents @ 59% → 70.8 → 71.
        _completed_run("B", 1, "sim_b1", 56.0, 100, price_yes=0.61),
        _completed_run("B", 2, "sim_b2", 59.0, 120),
        # A failed replicate must not contribute to the pooled counts.
        {
            "variant": "B",
            "replicate": 3,
            "label": "B r3",
            "simulation_id": "sim_b3",
            "phase": "failed",
            "status": "failed",
            "metrics": {},
        },
    ]
    return state


def test_results_payload_matches_ts_contract():
    state = _fixture_state()
    computed = {
        "demographic_winners": [{"dimension": "by_age_range", "segment": "18-24", "winner": "B"}],
        "pairwise_vs_baseline": {"A": {"baseline": True}, "B": {"t": 4.2}},
    }
    payload = build_results_payload("exp_fixture1", state, computed)

    # Field-for-field: exactly the TS ExperimentResults keys + raw.
    assert set(payload.keys()) == {
        "id", "metric", "metricType", "primaryUnit", "alpha",
        "requiredSampleSizePerVariant", "plannedDays", "observedDays",
        "variants", "guardrails", "notes", "raw",
    }
    assert payload["id"] == "exp_fixture1"
    assert payload["metric"] == "positive stance rate"
    assert payload["metricType"] == "binary"
    assert payload["primaryUnit"] == "agents"
    assert payload["alpha"] == 0.05
    assert payload["requiredSampleSizePerVariant"] == 0
    assert payload["plannedDays"] == 1
    assert payload["observedDays"] == 1
    assert payload["guardrails"] == []

    # Pooled Bernoulli counts: visitors = Σ agents, conversions = Σ bullish.
    assert payload["variants"] == [
        {"name": "control", "visitors": 200, "conversions": 94},     # 46 + 48
        {"name": "treatment", "visitors": 220, "conversions": 127},  # 56 + 71
    ]

    # Replicate means stay visible for honesty about clustering.
    assert "replicate means A: [46.0%, 48.0%]" in payload["notes"]
    assert "replicate means B: [56.0%, 59.0%]" in payload["notes"]

    # raw carries per-replicate detail + passthroughs.
    per_rep = payload["raw"]["per_replicate"]
    assert len(per_rep) == 4  # the failed replicate is not a completed observation
    first = per_rep[0]
    assert first == {
        "variant": "A",
        "replicate": 1,
        "simulation_id": "sim_a1",
        "bullish_pct": 46.0,
        "agents": 100,
        "amm_yes_probability": 0.44,
    }
    assert per_rep[1]["amm_yes_probability"] is None
    assert payload["raw"]["per_demographic"] == computed["demographic_winners"]
    assert payload["raw"]["welch_cli"] == computed["pairwise_vs_baseline"]


def test_results_payload_skips_runs_without_agent_counts():
    state = _fixture_state()
    # Strip the demographics payload from one completed run: it must drop
    # out of the pooled totals (never invent n) but stay in per_replicate.
    state["runs"][1]["metrics"] = {}
    payload = build_results_payload("exp_fixture2", state, {})

    assert payload["variants"][0] == {"name": "control", "visitors": 100, "conversions": 46}
    assert any("excluded from pooled counts" in note for note in payload["notes"])
    assert len(payload["raw"]["per_replicate"]) == 4
    assert payload["raw"]["per_replicate"][1]["agents"] is None


def test_results_requires_complete_status():
    exp_dir = Path(ABExperimentService.EXPERIMENTS_DIR) / "exp_partial01"
    state = _fixture_state()
    state["experiment_id"] = "exp_partial01"
    state["status"] = "running"
    state["error"] = None
    save_state(exp_dir, state)

    with pytest.raises(ExperimentNotCompleteError):
        ABExperimentService.get_results("exp_partial01")

    state["status"] = "complete"
    save_state(exp_dir, state)
    payload = ABExperimentService.get_results("exp_partial01")
    assert payload["id"] == "exp_partial01"
    assert payload["variants"][0]["name"] == "control"


def test_compute_progress_counts_states():
    state = {
        "runs": [
            {"status": "completed", "phase": "terminal",
             "last_status": {"current_round": 48, "total_rounds": 48}},
            {"status": "running", "phase": "running",
             "last_status": {"current_round": 31, "total_rounds": 48}},
            {"status": "running", "phase": "started", "last_status": {}},
            {"status": None, "phase": "planned"},
        ]
    }
    progress = compute_progress(state)
    assert progress == {
        "runs_total": 4,
        "runs_done": 1,
        "runs_active": 2,
        "current_round_max": 48,
        "rounds_per_run": 48,
    }
