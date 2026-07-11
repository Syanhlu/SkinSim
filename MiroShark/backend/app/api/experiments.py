"""
A/B experiment API — the async-job HTTP surface over
:class:`app.services.ab_experiment_service.ABExperimentService`.

Everything ``scripts/ab_experiment.py`` does, as a create-then-poll job:

* ``POST /api/experiments/ab-test``            → 202, launch in background
* ``GET  /api/experiments/<id>/status``        → poll progress
* ``GET  /api/experiments/<id>/results``       → TS ``ExperimentResults`` contract
* ``GET  /api/experiments/list``               → every experiment on disk

All routes sit behind the app-level internal-key guard (``/api/*`` in
``app/__init__.py``) — deliberately **no** new exemptions: experiments
drive paid simulation runs, so a keyless caller has no business here.

Unlike most of the codebase these endpoints do NOT use the
``{"success": true, "data": ...}`` envelope: the Next.js product app
consumes the response bodies directly against its TypeScript contracts
(Phase 3 of the VNG plan), so the shapes below are returned verbatim.
"""

from flask import jsonify, request

from . import experiments_bp
from ..services.ab_experiment_service import (
    ABExperimentService,
    ExperimentConflictError,
    ExperimentNotCompleteError,
)
from ..utils.logger import get_logger

logger = get_logger('miroshark.api.experiments')


def _bad_request(message: str):
    return jsonify({"error": message}), 400


@experiments_bp.route('/ab-test', methods=['POST'])
def create_ab_test():
    """Create an A/B experiment and start it in a background worker.

    Body::

        {
          "hypothesis": "...",                  # required, stored for the report
          "scenario": "...",                    # XOR parent_simulation_id
          "parent_simulation_id": "sim_...",
          "variants": [{"name": "A", "text": "..."}, {"name": "B", "text": "..."}],
          "replicates": 3, "parallel": 2, "trigger_round": 0   # optional
        }

    Returns ``202 {experiment_id, parent_simulation_id, status}``.
    400 on invalid input; 409 when another experiment is running
    (single worker per instance).
    """
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _bad_request("Request body must be a JSON object.")

    hypothesis = payload.get("hypothesis")
    if not isinstance(hypothesis, str) or not hypothesis.strip():
        return _bad_request("hypothesis is required (non-empty string).")

    scenario = payload.get("scenario")
    parent_simulation_id = payload.get("parent_simulation_id")
    if not scenario and not parent_simulation_id:
        return _bad_request("Provide scenario or parent_simulation_id.")
    if scenario and parent_simulation_id:
        return _bad_request("Use scenario OR parent_simulation_id, not both.")

    variants = payload.get("variants")
    if not isinstance(variants, list) or len(variants) < 2:
        return _bad_request("Provide at least 2 variants.")

    def _int_field(name, default, minimum):
        value = payload.get(name, default)
        try:
            value = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"{name} must be an integer >= {minimum}")
        if value < minimum:
            raise ValueError(f"{name} must be >= {minimum}")
        return value

    try:
        replicates = _int_field("replicates", 3, 1)
        parallel = _int_field("parallel", 2, 1)
        trigger_round = _int_field("trigger_round", 0, 0)
    except ValueError as exc:
        return _bad_request(str(exc))

    try:
        job = ABExperimentService.create_experiment(
            hypothesis=hypothesis.strip(),
            variants=variants,
            scenario=scenario,
            parent_simulation_id=parent_simulation_id,
            replicates=replicates,
            parallel=parallel,
            trigger_round=trigger_round,
        )
    except ExperimentConflictError as exc:
        return jsonify({"error": str(exc)}), 409
    except ValueError as exc:
        return _bad_request(str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        logger.error(f"Failed to create experiment: {exc}")
        return jsonify({"error": str(exc)}), 500

    logger.info(
        f"Experiment created: {job['experiment_id']} "
        f"({len(variants)} variants x {replicates} replicates)"
    )
    return jsonify(job), 202


@experiments_bp.route('/<experiment_id>/status', methods=['GET'])
def experiment_status(experiment_id: str):
    """Poll an experiment: status, progress block, per-run states, error."""
    status = ABExperimentService.get_status(experiment_id)
    if status is None:
        return jsonify({"error": f"Unknown experiment: {experiment_id}"}), 404
    return jsonify(status), 200


@experiments_bp.route('/<experiment_id>/results', methods=['GET'])
def experiment_results(experiment_id: str):
    """Final results in the TS ``ExperimentResults`` shape (+ ``raw``).

    200 only once the experiment is ``complete``; 409 while it is still
    preparing/running or after a failure; 404 for an unknown id.
    """
    try:
        results = ABExperimentService.get_results(experiment_id)
    except ExperimentNotCompleteError as exc:
        return jsonify({"error": str(exc)}), 409
    if results is None:
        return jsonify({"error": f"Unknown experiment: {experiment_id}"}), 404
    return jsonify(results), 200


@experiments_bp.route('/list', methods=['GET'])
def experiment_list():
    """Every experiment on disk (uploads/experiments), newest first."""
    return jsonify({"experiments": ABExperimentService.list_experiments()}), 200
