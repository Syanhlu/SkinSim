#!/usr/bin/env python3
"""
A/B experiment orchestrator for MiroShark simulations — CLI entry point.

The orchestration itself (parent prep → branch-counterfactual per
variant×replicate → bounded parallel start → batch-status polling →
metrics collection → small-sample stats → report) lives in
``app/services/ab_experiment_service.py`` and is shared with the
``/api/experiments`` HTTP surface. This script is the thin argparse
wrapper: flags, ``--dry-run`` and ``--resume`` behave exactly as before.
"""

import argparse
import os
import pathlib
import sys

# Repo layout: backend/{app,scripts,tests}. Make ``import app`` work when
# invoked as ``python scripts/ab_experiment.py`` from the backend dir (or
# anywhere else).
_BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.services.ab_experiment_service import (  # noqa: E402
    RESULTS_FILE,
    REPORT_FILE,
    STATE_FILE,
    ApiClient,
    build_initial_state,
    create_parent,
    fetch_metrics,
    load_json,
    make_planned_runs,
    run_branches,
    save_state,
    short_text,
    utc_stamp,
    write_outputs,
)


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


def initial_state(args, variants, out_dir):
    return build_initial_state(
        api_url=args.api_url,
        out_dir=out_dir,
        variants=variants,
        replicates=args.replicates,
        parallel=args.parallel,
        trigger_round=args.trigger_round,
        poll_interval=args.poll_interval,
        parent_simulation_id=args.parent_id,
        scenario_text="" if args.parent_id else scenario_text_from_args(args),
    )


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
