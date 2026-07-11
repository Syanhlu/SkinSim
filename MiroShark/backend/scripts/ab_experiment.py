#!/usr/bin/env python3
"""
A/B experiment orchestrator for MiroShark simulations.

Stdlib only. The script creates or reuses one prepared parent simulation,
branches one counterfactual run per variant replicate, starts branch runs with
a bounded active-run count, polls until terminal, then writes raw results plus
small-sample statistics.
"""

import argparse
import json
import math
import os
import pathlib
import statistics
import time
import urllib.request


STATE_FILE = "state.json"
RESULTS_FILE = "results.json"
REPORT_FILE = "report.md"

TERMINAL_OK = {"completed"}
TERMINAL_FAIL = {"failed", "stopped", "cancelled", "canceled", "error"}
TERMINAL_ANY = TERMINAL_OK | TERMINAL_FAIL

T_CRIT_95 = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
    11: 2.201,
    12: 2.179,
    13: 2.160,
    14: 2.145,
    15: 2.131,
    16: 2.120,
    17: 2.110,
    18: 2.101,
    19: 2.093,
    20: 2.086,
    21: 2.080,
    22: 2.074,
    23: 2.069,
    24: 2.064,
    25: 2.060,
    26: 2.056,
    27: 2.052,
    28: 2.048,
    29: 2.045,
    30: 2.042,
}


def utc_now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def utc_stamp():
    return time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())


def short_text(text, limit=80):
    text = " ".join((text or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def safe_slug(value, fallback="item"):
    out = []
    for ch in (value or "").lower():
        if "a" <= ch <= "z" or "0" <= ch <= "9":
            out.append(ch)
        elif ch in "-_.":
            out.append(ch)
        elif ch.isspace():
            out.append("-")
    slug = "".join(out).strip("-_.")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return (slug or fallback)[:48]


def read_text_arg(value):
    if value and value.startswith("@"):
        return pathlib.Path(value[1:]).read_text(encoding="utf-8")
    return value or ""


def parse_variant(spec):
    if "=" not in spec:
        raise argparse.ArgumentTypeError("--variant must be NAME=TEXT or NAME=@file.txt")
    name, text = spec.split("=", 1)
    name = name.strip()
    if not name:
        raise argparse.ArgumentTypeError("variant name cannot be empty")
    text = read_text_arg(text)
    if not text.strip():
        raise argparse.ArgumentTypeError("variant text cannot be empty")
    return {"name": name, "text": text}


def json_pretty(obj):
    return json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True)


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json_pretty(obj) + "\n", encoding="utf-8")


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(out_dir, state):
    state["updated_at_utc"] = utc_now()
    write_json(out_dir / STATE_FILE, state)


def response_success(res):
    return isinstance(res, dict) and res.get("success") is not False and "error" not in res


def require_success(res, context):
    if response_success(res):
        return res
    error = "unknown error"
    if isinstance(res, dict):
        error = res.get("error") or res.get("message") or json.dumps(res, ensure_ascii=False)
    raise RuntimeError(context + ": " + str(error))


class ApiClient:
    def __init__(self, base_url, internal_key):
        self.base_url = (base_url or "").rstrip("/")
        self.internal_key = internal_key or ""

    def request_json(self, method, path, body=None, keyless=False, timeout=120):
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        return self._request(method, path, data, headers, keyless, timeout)

    def request_multipart(self, path, fields, timeout=300):
        boundary = "----miroshark-ab-" + str(os.getpid()) + "-" + str(int(time.time() * 1000))
        chunks = []
        for name, value in fields.items():
            chunks.append(("--" + boundary + "\r\n").encode("utf-8"))
            chunks.append(
                ('Content-Disposition: form-data; name="' + name + '"\r\n\r\n').encode(
                    "utf-8"
                )
            )
            chunks.append(str(value).encode("utf-8"))
            chunks.append(b"\r\n")
        chunks.append(("--" + boundary + "--\r\n").encode("utf-8"))
        data = b"".join(chunks)
        headers = {
            "Accept": "application/json",
            "Content-Type": "multipart/form-data; boundary=" + boundary,
        }
        return self._request("POST", path, data, headers, False, timeout)

    def _request(self, method, path, data, headers, keyless, timeout):
        url = self.base_url + path
        if self.internal_key and not keyless:
            headers = dict(headers)
            headers["x-miroshark-internal-key"] = self.internal_key

        last = {"success": False, "error": "request was not attempted"}
        for attempt in range(1, 4):
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    raw = resp.read().decode("utf-8")
                    parsed = self._parse_json(raw)
                    if isinstance(parsed, dict):
                        parsed.setdefault("_http_status", resp.getcode())
                    return parsed
            except Exception as exc:
                status = getattr(exc, "code", None)
                raw = ""
                if hasattr(exc, "read"):
                    try:
                        raw = exc.read().decode("utf-8", errors="replace")
                    except Exception:
                        raw = ""
                parsed = self._parse_json(raw) if raw else {}
                if not isinstance(parsed, dict):
                    parsed = {"data": parsed}
                parsed.setdefault("success", False)
                if status is not None:
                    parsed.setdefault("_http_status", status)
                    parsed.setdefault("error", "HTTP " + str(status) + ": " + raw[:300])
                else:
                    parsed.setdefault("error", "request error: " + str(exc))
                last = parsed
                if attempt < 3:
                    time.sleep(2 ** (attempt - 1))
        return last

    def _parse_json(self, raw):
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception as exc:
            return {"success": False, "error": "invalid JSON from server: " + str(exc)}


def build_parser():
    parser = argparse.ArgumentParser(
        description="Run MiroShark A/B experiments with counterfactual branches."
    )
    parser.add_argument(
        "--api-url",
        default=os.environ.get("MIROSHARK_API_URL", "http://localhost:5001"),
        help="Base API URL. Default: env MIROSHARK_API_URL or http://localhost:5001.",
    )
    parser.add_argument(
        "--internal-key",
        default=os.environ.get("MIROSHARK_INTERNAL_KEY", ""),
        help="Internal API key. Default: env MIROSHARK_INTERNAL_KEY.",
    )
    parser.add_argument("--parent-id", help="Existing prepared parent simulation id.")
    parser.add_argument("--scenario", help="Scenario text used to create a parent simulation.")
    parser.add_argument("--scenario-file", help="File containing scenario text.")
    parser.add_argument(
        "--variant",
        action="append",
        default=[],
        type=parse_variant,
        help="Variant as NAME=TEXT. Use NAME=@file.txt to load text from a file. Repeat >=2.",
    )
    parser.add_argument("--replicates", type=int, default=3)
    parser.add_argument("--parallel", type=int, default=2)
    parser.add_argument("--trigger-round", type=int, default=0)
    parser.add_argument("--poll-interval", type=int, default=30)
    parser.add_argument(
        "--out",
        help="Output directory. Default: ./experiments/<UTC timestamp>.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print run matrix; no HTTP.")
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Reload <out>/state.json and continue.",
    )
    return parser


def validate_args(parser, args):
    if args.replicates < 1:
        parser.error("--replicates must be >= 1")
    if args.parallel < 1:
        parser.error("--parallel must be >= 1")
    if args.trigger_round < 0:
        parser.error("--trigger-round must be >= 0")
    if args.poll_interval < 1:
        parser.error("--poll-interval must be >= 1")

    if args.resume:
        if not args.out:
            parser.error("--resume requires --out")
        return

    scenario_sources = [bool(args.scenario), bool(args.scenario_file)]
    if args.parent_id and any(scenario_sources):
        parser.error("use --parent-id OR --scenario/--scenario-file, not both")
    if not args.parent_id and sum(1 for x in scenario_sources if x) != 1:
        parser.error("provide --parent-id or exactly one of --scenario/--scenario-file")
    if len(args.variant) < 2:
        parser.error("provide --variant at least twice")

    names = []
    for variant in args.variant:
        if variant["name"] in names:
            parser.error("duplicate variant name: " + variant["name"])
        names.append(variant["name"])


def scenario_text_from_args(args):
    if args.scenario_file:
        return pathlib.Path(args.scenario_file).read_text(encoding="utf-8")
    return args.scenario or ""


def make_out_dir(args):
    if args.out:
        return pathlib.Path(args.out)
    return pathlib.Path("experiments") / utc_stamp()


def make_planned_runs(variants, replicates, trigger_round):
    runs = []
    stamp = utc_stamp().lower()
    for variant in variants:
        slug = safe_slug(variant["name"], "variant")
        for replicate in range(1, replicates + 1):
            runs.append(
                {
                    "variant": variant["name"],
                    "replicate": replicate,
                    "label": variant["name"] + " r" + str(replicate),
                    "branch_id": "ab-" + stamp + "-" + slug + "-r" + str(replicate),
                    "trigger_round": trigger_round,
                    "phase": "planned",
                    "simulation_id": None,
                    "status": None,
                    "errors": [],
                    "responses": {},
                    "metrics": {},
                }
            )
    return runs


def initial_state(args, variants, out_dir):
    scenario_text = "" if args.parent_id else scenario_text_from_args(args)
    return {
        "schema_version": 1,
        "created_at_utc": utc_now(),
        "updated_at_utc": utc_now(),
        "api_url": args.api_url,
        "out_dir": str(out_dir),
        "config": {
            "replicates": args.replicates,
            "parallel": args.parallel,
            "trigger_round": args.trigger_round,
            "poll_interval": args.poll_interval,
        },
        "parent": {
            "simulation_id": args.parent_id,
            "project_id": None,
            "graph_id": None,
            "phase": "provided" if args.parent_id else "not_created",
            "ready": False,
            "scenario_text": scenario_text,
        },
        "variants": variants,
        "runs": make_planned_runs(variants, args.replicates, args.trigger_round),
        "artifacts": {},
    }


def dry_run(args):
    variants = args.variant
    print("MiroShark A/B experiment dry run")
    print("API URL: " + args.api_url)
    if args.parent_id:
        print("Parent: reuse " + args.parent_id)
    else:
        scenario = scenario_text_from_args(args)
        print("Parent: create from scenario (" + str(len(scenario)) + " chars)")
        print("Synthetic document: scenario.txt")
    print("Replicates per variant: " + str(args.replicates))
    print("Parallel active runs: " + str(args.parallel))
    print("Trigger round: " + str(args.trigger_round))
    print("")
    print("Variants:")
    for variant in variants:
        print("- " + variant["name"] + ": " + short_text(variant["text"]))
    print("")
    print("Run matrix:")
    for run in make_planned_runs(variants, args.replicates, args.trigger_round):
        print(
            "- "
            + run["variant"]
            + " replicate "
            + str(run["replicate"])
            + " branch_id="
            + run["branch_id"]
        )
    print("")
    print("No HTTP requests made.")


def poll_task(client, path, task_id, poll_interval, context):
    while True:
        res = client.request_json("GET", path + task_id, timeout=60)
        require_success(res, context + " status")
        data = res.get("data") or {}
        status = str(data.get("status") or "").lower()
        progress = data.get("progress")
        message = data.get("message") or ""
        print(context + ": " + (status or "?") + " " + str(progress) + "% " + message)
        if status == "completed":
            return data
        if status == "failed":
            raise RuntimeError(context + " failed: " + str(data.get("error") or message))
        time.sleep(poll_interval)


def prepare_status(client, simulation_id, task_id=None):
    body = {"simulation_id": simulation_id}
    if task_id:
        body["task_id"] = task_id
    res = client.request_json("POST", "/api/simulation/prepare/status", body=body, timeout=60)
    require_success(res, "prepare status")
    return res.get("data") or {}


def ensure_parent_ready(client, state, out_dir, poll_interval):
    parent = state["parent"]
    simulation_id = parent.get("simulation_id")
    if not simulation_id:
        raise RuntimeError("parent simulation id is missing")

    status = prepare_status(client, simulation_id)
    if status.get("already_prepared") or str(status.get("status") or "").lower() == "ready":
        parent["ready"] = True
        parent["phase"] = "ready"
        parent["prepare_status"] = status
        save_state(out_dir, state)
        return

    print("Preparing parent simulation " + simulation_id)
    res = client.request_json("POST", "/api/simulation/prepare", body={"simulation_id": simulation_id}, timeout=120)
    require_success(res, "prepare parent")
    data = res.get("data") or {}
    parent["phase"] = "preparing"
    parent["prepare_task_id"] = data.get("task_id")
    parent["prepare_response"] = data
    save_state(out_dir, state)

    if data.get("already_prepared") or str(data.get("status") or "").lower() == "ready":
        parent["ready"] = True
        parent["phase"] = "ready"
        save_state(out_dir, state)
        return

    task_id = data.get("task_id")
    while True:
        status = prepare_status(client, simulation_id, task_id)
        parent["prepare_status"] = status
        save_state(out_dir, state)
        status_value = str(status.get("status") or "").lower()
        progress = status.get("progress")
        message = status.get("message") or ""
        print("parent prepare: " + status_value + " " + str(progress) + "% " + message)
        if status.get("already_prepared") or status_value in ("ready", "completed"):
            parent["ready"] = True
            parent["phase"] = "ready"
            save_state(out_dir, state)
            return
        if status_value == "failed":
            raise RuntimeError("parent preparation failed: " + str(status.get("error") or message))
        time.sleep(poll_interval)


def create_parent(client, state, out_dir, poll_interval):
    parent = state["parent"]
    if parent.get("simulation_id"):
        ensure_parent_ready(client, state, out_dir, poll_interval)
        return

    scenario = parent.get("scenario_text") or ""
    project_name = "A/B Experiment " + utc_stamp()
    docs = [{"title": "scenario.txt", "url": "scenario.txt", "text": scenario}]

    print("Creating parent project and ontology")
    res = client.request_multipart(
        "/api/graph/ontology/generate",
        {
            "simulation_requirement": scenario,
            "project_name": project_name,
            "url_docs": json.dumps(docs, ensure_ascii=False),
        },
        timeout=600,
    )
    require_success(res, "ontology generation")
    data = res.get("data") or {}
    project_id = data.get("project_id")
    if not project_id:
        raise RuntimeError("ontology generation did not return project_id")
    parent["project_id"] = project_id
    parent["phase"] = "ontology_generated"
    parent["ontology_response"] = data
    save_state(out_dir, state)

    print("Building graph for parent project " + project_id)
    res = client.request_json(
        "POST",
        "/api/graph/build",
        body={"project_id": project_id, "graph_name": project_name},
        timeout=120,
    )
    require_success(res, "graph build start")
    data = res.get("data") or {}
    task_id = data.get("task_id")
    if not task_id:
        raise RuntimeError("graph build did not return task_id")
    parent["phase"] = "graph_building"
    parent["graph_task_id"] = task_id
    save_state(out_dir, state)

    task = poll_task(client, "/api/graph/task/", task_id, poll_interval, "graph build")
    result = task.get("result") or {}
    graph_id = result.get("graph_id")
    if not graph_id:
        raise RuntimeError("graph build completed without graph_id")
    parent["graph_id"] = graph_id
    parent["phase"] = "graph_built"
    parent["graph_task_result"] = result
    save_state(out_dir, state)

    print("Creating parent simulation")
    res = client.request_json(
        "POST",
        "/api/simulation/create",
        body={"project_id": project_id, "graph_id": graph_id},
        timeout=120,
    )
    require_success(res, "simulation create")
    data = res.get("data") or {}
    simulation_id = data.get("simulation_id")
    if not simulation_id:
        raise RuntimeError("simulation create did not return simulation_id")
    parent["simulation_id"] = simulation_id
    parent["phase"] = "created"
    parent["create_response"] = data
    save_state(out_dir, state)

    ensure_parent_ready(client, state, out_dir, poll_interval)


def variant_text_by_name(state, name):
    for variant in state.get("variants") or []:
        if variant.get("name") == name:
            return variant.get("text") or ""
    return ""


def start_next_run(client, state, out_dir):
    parent_id = state["parent"].get("simulation_id")
    for run in state.get("runs") or []:
        if run.get("phase") not in ("planned", "branched"):
            continue

        if not run.get("simulation_id"):
            print("Branching " + run["label"])
            body = {
                "parent_simulation_id": parent_id,
                "injection_text": variant_text_by_name(state, run["variant"]),
                "trigger_round": run.get("trigger_round", 0),
                "label": run["label"],
                "branch_id": run["branch_id"],
            }
            res = client.request_json(
                "POST",
                "/api/simulation/branch-counterfactual",
                body=body,
                timeout=120,
            )
            run["responses"]["branch"] = res
            if not response_success(res):
                run["phase"] = "failed"
                run["status"] = "branch_failed"
                run["errors"].append(res.get("error", "branch failed") if isinstance(res, dict) else "branch failed")
                save_state(out_dir, state)
                return True
            data = res.get("data") or {}
            simulation_id = data.get("simulation_id")
            if not simulation_id:
                run["phase"] = "failed"
                run["status"] = "branch_failed"
                run["errors"].append("branch response missing simulation_id")
                save_state(out_dir, state)
                return True
            run["simulation_id"] = simulation_id
            run["phase"] = "branched"
            run["status"] = "branched"
            save_state(out_dir, state)

        print("Starting " + run["label"] + " as " + run["simulation_id"])
        res = client.request_json(
            "POST",
            "/api/simulation/start",
            body={"simulation_id": run["simulation_id"]},
            timeout=120,
        )
        run["responses"]["start"] = res
        if not response_success(res):
            run["phase"] = "failed"
            run["status"] = "start_failed"
            run["errors"].append(res.get("error", "start failed") if isinstance(res, dict) else "start failed")
            save_state(out_dir, state)
            return True
        data = res.get("data") or {}
        run["phase"] = "started"
        run["status"] = str(data.get("runner_status") or data.get("status") or "running").lower()
        run["started_at_utc"] = utc_now()
        save_state(out_dir, state)
        return True
    return False


def active_runs(state):
    active = []
    for run in state.get("runs") or []:
        if run.get("phase") in ("started", "running") and run.get("simulation_id"):
            status = str(run.get("status") or "").lower()
            if status not in TERMINAL_ANY:
                active.append(run)
    return active


def pending_runs(state):
    return [run for run in state.get("runs") or [] if run.get("phase") in ("planned", "branched")]


def status_from_run_status(res):
    if not response_success(res):
        return None, {}
    data = res.get("data") or {}
    status = str(data.get("runner_status") or data.get("status") or "").lower()
    return status, data


def batch_status_map(client, sim_ids):
    out = {}
    for i in range(0, len(sim_ids), 20):
        chunk = sim_ids[i : i + 20]
        res = client.request_json(
            "POST",
            "/api/simulation/batch-status",
            body={"sim_ids": chunk},
            keyless=True,
            timeout=60,
        )
        if not response_success(res):
            continue
        data = res.get("data") or {}
        for entry in data.get("results") or []:
            sim_id = entry.get("sim_id")
            if sim_id:
                out[sim_id] = entry
    return out


def poll_active_runs(client, state, out_dir):
    runs = active_runs(state)
    if not runs:
        return 0

    sim_ids = [run["simulation_id"] for run in runs]
    batch = batch_status_map(client, sim_ids)
    terminals = 0

    for run in runs:
        sim_id = run["simulation_id"]
        entry = batch.get(sim_id)
        status = None
        detail = {}
        if entry and entry.get("found"):
            status = str(entry.get("status") or "").lower()
            detail = entry

        if not status:
            res = client.request_json("GET", "/api/simulation/" + sim_id + "/run-status", timeout=60)
            run["responses"]["last_run_status"] = res
            status, detail = status_from_run_status(res)

        if status:
            run["status"] = status
        if detail:
            run["last_status"] = detail

        if status in TERMINAL_ANY:
            run["phase"] = "terminal"
            run["terminal_status"] = status
            run["terminal_at_utc"] = utc_now()
            terminals += 1
            print(run["label"] + " terminal: " + status)
        else:
            run["phase"] = "running"

    save_state(out_dir, state)
    return terminals


def run_branches(client, state, out_dir, parallel, poll_interval):
    while True:
        while len(active_runs(state)) < parallel and pending_runs(state):
            made_progress = start_next_run(client, state, out_dir)
            if not made_progress:
                break

        active = active_runs(state)
        if not active and not pending_runs(state):
            return

        terminals = poll_active_runs(client, state, out_dir)
        if terminals == 0:
            active_count = len(active_runs(state))
            pending_count = len(pending_runs(state))
            print(
                "Polling: "
                + str(active_count)
                + " active, "
                + str(pending_count)
                + " waiting"
            )
            time.sleep(poll_interval)


def final_belief_from_drift(payload):
    if not isinstance(payload, dict):
        return None
    data = payload.get("data")
    if not isinstance(data, dict):
        return None
    bullish = data.get("bullish") or []
    neutral = data.get("neutral") or []
    bearish = data.get("bearish") or []
    rounds = data.get("rounds") or []
    if not bullish:
        return None
    idx = len(bullish) - 1
    return {
        "round": rounds[idx] if idx < len(rounds) else None,
        "bullish_pct": as_float(bullish[idx]),
        "neutral_pct": as_float(neutral[idx]) if idx < len(neutral) else None,
        "bearish_pct": as_float(bearish[idx]) if idx < len(bearish) else None,
    }


def as_float(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except Exception:
        return None


def fetch_metrics(client, state, out_dir):
    for run in state.get("runs") or []:
        if not run.get("simulation_id"):
            continue
        if run.get("phase") == "metrics_fetched":
            continue
        if run.get("metrics_fetched_at_utc"):
            continue
        if run.get("phase") not in ("terminal", "failed"):
            continue

        sim_id = run["simulation_id"]
        print("Fetching metrics for " + run["label"] + " (" + sim_id + ")")
        metrics = run.get("metrics") or {}

        status = client.request_json("GET", "/api/simulation/" + sim_id + "/run-status", timeout=60)
        detail = client.request_json(
            "GET", "/api/simulation/" + sim_id + "/run-status/detail", timeout=120
        )
        drift = client.request_json("GET", "/api/simulation/" + sim_id + "/belief-drift", timeout=120)
        demo = client.request_json("GET", "/api/simulation/" + sim_id + "/demographics", timeout=120)
        cost = client.request_json("GET", "/api/simulation/" + sim_id + "/cost.json", timeout=120)

        metrics["run_status"] = status
        metrics["run_status_detail"] = detail
        metrics["belief_drift"] = drift
        metrics["demographics"] = demo
        metrics["cost"] = cost
        metrics["final_belief"] = final_belief_from_drift(drift)
        run["metrics"] = metrics
        if response_success(drift) and metrics["final_belief"]:
            run["final_bullish_pct"] = metrics["final_belief"].get("bullish_pct")
        run["metrics_fetched_at_utc"] = utc_now()
        if run.get("phase") != "failed":
            run["phase"] = "metrics_fetched"
        save_state(out_dir, state)


def t_crit_95(df):
    if df is None:
        return None
    try:
        df_int = int(math.floor(float(df)))
    except Exception:
        return None
    if df_int < 1:
        df_int = 1
    if df_int > 30:
        return 1.96
    return T_CRIT_95[df_int]


def sample_values_for_variant(state, variant_name):
    values = []
    for run in state.get("runs") or []:
        if run.get("variant") != variant_name:
            continue
        if str(run.get("status") or "").lower() not in TERMINAL_OK:
            continue
        value = as_float(run.get("final_bullish_pct"))
        if value is not None:
            values.append(value)
    return values


def summarize_sample(values):
    n = len(values)
    if n == 0:
        return {
            "n": 0,
            "mean": None,
            "sample_std": None,
            "ci95": None,
            "values": values,
        }
    mean = statistics.mean(values)
    if n == 1:
        return {
            "n": 1,
            "mean": round(mean, 4),
            "sample_std": None,
            "ci95": [round(mean, 4), round(mean, 4)],
            "values": values,
        }
    std = statistics.stdev(values)
    crit = t_crit_95(n - 1)
    half = crit * std / math.sqrt(n)
    return {
        "n": n,
        "mean": round(mean, 4),
        "sample_std": round(std, 4),
        "ci95": [round(mean - half, 4), round(mean + half, 4)],
        "values": values,
    }


def sample_variance(values):
    if len(values) < 2:
        return None
    return statistics.variance(values)


def welch_vs_baseline(baseline, sample):
    if len(baseline) < 2 or len(sample) < 2:
        return {
            "t": None,
            "df": None,
            "significant_5pct": False,
            "verdict": "not significant",
            "reason": "need at least two observations per variant",
        }

    mean_a = statistics.mean(baseline)
    mean_b = statistics.mean(sample)
    var_a = sample_variance(baseline)
    var_b = sample_variance(sample)
    if var_a is None or var_b is None:
        return {
            "t": None,
            "df": None,
            "significant_5pct": False,
            "verdict": "not significant",
            "reason": "variance unavailable",
        }

    se2 = var_a / len(baseline) + var_b / len(sample)
    if se2 <= 0:
        return {
            "t": None,
            "df": None,
            "significant_5pct": False,
            "verdict": "not significant",
            "reason": "zero variance",
        }

    t_stat = (mean_b - mean_a) / math.sqrt(se2)
    numerator = se2 * se2
    term_a = (var_a / len(baseline)) ** 2 / (len(baseline) - 1)
    term_b = (var_b / len(sample)) ** 2 / (len(sample) - 1)
    df = numerator / (term_a + term_b) if (term_a + term_b) > 0 else None
    crit = t_crit_95(df)
    significant = bool(crit is not None and abs(t_stat) > crit)
    return {
        "t": round(t_stat, 4),
        "df": round(df, 4) if df is not None else None,
        "critical_95": crit,
        "significant_5pct": significant,
        "verdict": "significant" if significant else "not significant",
    }


def demographic_values(run):
    demo = ((run.get("metrics") or {}).get("demographics") or {}).get("data")
    if not isinstance(demo, dict):
        return {}
    dims = demo.get("dimensions")
    if not isinstance(dims, dict):
        return {}
    out = {}
    for dim_name, segments in dims.items():
        if not isinstance(segments, dict):
            continue
        for segment, summary in segments.items():
            if not isinstance(summary, dict):
                continue
            value = as_float(summary.get("bullish_pct"))
            if value is None:
                continue
            out[(dim_name, segment)] = value
    return out


def compute_demographic_winners(state):
    collector = {}
    variants = [v.get("name") for v in state.get("variants") or []]
    for run in state.get("runs") or []:
        variant = run.get("variant")
        if variant not in variants:
            continue
        # Failed/stopped runs report all-zero demographics; including them
        # would crown a "winner" at 0.00% even when nothing actually ran.
        status = str(run.get("status") or "").lower()
        if status not in TERMINAL_OK:
            continue
        for key, value in demographic_values(run).items():
            collector.setdefault(key, {}).setdefault(variant, []).append(value)

    rows = []
    for key in sorted(collector.keys()):
        dim_name, segment = key
        means = {}
        counts = {}
        for variant, values in collector[key].items():
            if values:
                means[variant] = round(statistics.mean(values), 4)
                counts[variant] = len(values)
        if not means:
            continue
        ordered = sorted(means.items(), key=lambda item: (-item[1], item[0]))
        winner, winner_mean = ordered[0]
        runner_up = ordered[1][0] if len(ordered) > 1 else None
        runner_up_mean = ordered[1][1] if len(ordered) > 1 else None
        rows.append(
            {
                "dimension": dim_name,
                "segment": segment,
                "winner": winner,
                "winner_mean_bullish_pct": winner_mean,
                "runner_up": runner_up,
                "runner_up_mean_bullish_pct": runner_up_mean,
                "variant_means": means,
                "variant_counts": counts,
            }
        )
    return rows


def cost_value(run):
    cost = ((run.get("metrics") or {}).get("cost") or {})
    if isinstance(cost, dict) and cost.get("success") is False:
        return None
    return as_float(cost.get("estimated_cost_usd")) if isinstance(cost, dict) else None


def compute_results(state):
    variants = [v.get("name") for v in state.get("variants") or []]
    baseline = variants[0] if variants else None
    baseline_values = sample_values_for_variant(state, baseline) if baseline else []

    variant_stats = {}
    pairwise = {}
    for variant in variants:
        values = sample_values_for_variant(state, variant)
        summary = summarize_sample(values)
        delta = None
        if baseline_values and summary.get("mean") is not None:
            delta = summary["mean"] - statistics.mean(baseline_values)
        summary["delta_vs_baseline"] = round(delta, 4) if delta is not None else None
        variant_stats[variant] = summary
        if variant == baseline:
            pairwise[variant] = {
                "baseline": True,
                "verdict": "baseline",
                "significant_5pct": False,
            }
        else:
            pairwise[variant] = welch_vs_baseline(baseline_values, values)

    total_cost = 0.0
    cost_count = 0
    for run in state.get("runs") or []:
        value = cost_value(run)
        if value is not None:
            total_cost += value
            cost_count += 1

    return {
        "generated_at_utc": utc_now(),
        "baseline_variant": baseline,
        "variant_stats": variant_stats,
        "pairwise_vs_baseline": pairwise,
        "demographic_winners": compute_demographic_winners(state),
        "cost": {
            "total_estimated_cost_usd": round(total_cost, 6),
            "runs_with_cost": cost_count,
            "runs_total": len(state.get("runs") or []),
        },
        "caveat": "Sample sizes are small; results are directional, not confirmatory.",
    }


def fmt_num(value, digits=2):
    if value is None:
        return "n/a"
    return ("{0:." + str(digits) + "f}").format(float(value))


def fmt_ci(ci):
    if not ci:
        return "n/a"
    return "[" + fmt_num(ci[0], 2) + ", " + fmt_num(ci[1], 2) + "]"


def cost_note(run):
    cost = ((run.get("metrics") or {}).get("cost") or {})
    if not isinstance(cost, dict):
        return ""
    if cost.get("success") is False:
        return str(cost.get("error") or "unavailable")
    if cost.get("is_estimate"):
        return "estimate"
    return ""


def render_report(state, computed):
    lines = []
    lines.append("# MiroShark A/B Experiment Report")
    lines.append("")
    lines.append("Generated: " + computed["generated_at_utc"])
    lines.append("")
    lines.append(computed["caveat"])
    lines.append("")
    lines.append("## Parent")
    lines.append("")
    parent = state.get("parent") or {}
    lines.append("- Simulation id: `" + str(parent.get("simulation_id")) + "`")
    if parent.get("project_id"):
        lines.append("- Project id: `" + str(parent.get("project_id")) + "`")
    if parent.get("graph_id"):
        lines.append("- Graph id: `" + str(parent.get("graph_id")) + "`")
    lines.append("")

    lines.append("## Variant Summary")
    lines.append("")
    lines.append("| Variant | n | Mean bullish % | 95% CI | Delta vs baseline | Significant? |")
    lines.append("|---|---:|---:|---:|---:|---|")
    baseline = computed.get("baseline_variant")
    for variant, stats in computed.get("variant_stats", {}).items():
        pair = (computed.get("pairwise_vs_baseline") or {}).get(variant) or {}
        sig = "baseline" if variant == baseline else ("yes" if pair.get("significant_5pct") else "no")
        lines.append(
            "| "
            + variant
            + " | "
            + str(stats.get("n", 0))
            + " | "
            + fmt_num(stats.get("mean"), 2)
            + " | "
            + fmt_ci(stats.get("ci95"))
            + " | "
            + fmt_num(stats.get("delta_vs_baseline"), 2)
            + " | "
            + sig
            + " |"
        )
    lines.append("")

    lines.append("## Demographic Winners")
    lines.append("")
    demo_rows = computed.get("demographic_winners") or []
    if demo_rows:
        lines.append("| Dimension | Segment | Winner | Winner mean bullish % | Runner-up |")
        lines.append("|---|---|---|---:|---|")
        for row in demo_rows:
            runner = row.get("runner_up") or "n/a"
            if row.get("runner_up_mean_bullish_pct") is not None:
                runner += " (" + fmt_num(row.get("runner_up_mean_bullish_pct"), 2) + "%)"
            lines.append(
                "| "
                + str(row.get("dimension"))
                + " | "
                + str(row.get("segment"))
                + " | "
                + str(row.get("winner"))
                + " | "
                + fmt_num(row.get("winner_mean_bullish_pct"), 2)
                + " | "
                + runner
                + " |"
            )
    else:
        lines.append("No demographic metrics were available.")
    lines.append("")

    lines.append("## Simulation Runs And Cost")
    lines.append("")
    lines.append("| Variant | Replicate | Simulation id | Status | Final bullish % | Cost USD | Note |")
    lines.append("|---|---:|---|---|---:|---:|---|")
    for run in state.get("runs") or []:
        value = cost_value(run)
        lines.append(
            "| "
            + str(run.get("variant"))
            + " | "
            + str(run.get("replicate"))
            + " | `"
            + str(run.get("simulation_id"))
            + "` | "
            + str(run.get("terminal_status") or run.get("status") or run.get("phase"))
            + " | "
            + fmt_num(run.get("final_bullish_pct"), 2)
            + " | "
            + fmt_num(value, 4)
            + " | "
            + cost_note(run).replace("|", "/")
            + " |"
        )
    lines.append("")
    cost = computed.get("cost") or {}
    lines.append(
        "Total estimated cost across available runs: $"
        + fmt_num(cost.get("total_estimated_cost_usd"), 6)
        + " ("
        + str(cost.get("runs_with_cost"))
        + "/"
        + str(cost.get("runs_total"))
        + " runs with cost data)."
    )
    lines.append("")
    lines.append("## Endpoints Used")
    lines.append("")
    for endpoint in endpoints_used():
        lines.append("- `" + endpoint + "`")
    lines.append("")
    return "\n".join(lines)


def endpoints_used():
    return [
        "POST /api/graph/ontology/generate",
        "POST /api/graph/build",
        "GET /api/graph/task/<task_id>",
        "POST /api/simulation/create",
        "POST /api/simulation/prepare",
        "POST /api/simulation/prepare/status",
        "GET /api/simulation/<id>/run-status",
        "GET /api/simulation/<id>/run-status/detail",
        "POST /api/simulation/branch-counterfactual",
        "POST /api/simulation/start",
        "POST /api/simulation/batch-status",
        "GET /api/simulation/<id>/belief-drift",
        "GET /api/simulation/<id>/demographics",
        "GET /api/simulation/<id>/cost.json",
    ]


def write_outputs(state, out_dir):
    computed = compute_results(state)
    results = {
        "schema_version": 1,
        "raw": state,
        "computed": computed,
    }
    write_json(out_dir / RESULTS_FILE, results)
    (out_dir / REPORT_FILE).write_text(render_report(state, computed) + "\n", encoding="utf-8")
    state["artifacts"] = {
        "state": str(out_dir / STATE_FILE),
        "results": str(out_dir / RESULTS_FILE),
        "report": str(out_dir / REPORT_FILE),
    }
    save_state(out_dir, state)


def load_or_create_state(args, out_dir):
    if args.resume:
        state_path = out_dir / STATE_FILE
        if not state_path.exists():
            raise RuntimeError("--resume requested but state.json was not found at " + str(state_path))
        return load_json(state_path)
    variants = args.variant
    state = initial_state(args, variants, out_dir)
    save_state(out_dir, state)
    return state


def main():
    parser = build_parser()
    args = parser.parse_args()
    validate_args(parser, args)

    if args.dry_run:
        if args.resume:
            print("--dry-run with --resume only validates arguments; no state is loaded.")
        else:
            dry_run(args)
        return 0

    out_dir = make_out_dir(args)
    client = ApiClient(args.api_url, args.internal_key)
    state = load_or_create_state(args, out_dir)

    create_parent(client, state, out_dir, state["config"]["poll_interval"])
    run_branches(
        client,
        state,
        out_dir,
        int(state["config"]["parallel"]),
        int(state["config"]["poll_interval"]),
    )
    fetch_metrics(client, state, out_dir)
    write_outputs(state, out_dir)

    print("Wrote " + str(out_dir / RESULTS_FILE))
    print("Wrote " + str(out_dir / REPORT_FILE))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
