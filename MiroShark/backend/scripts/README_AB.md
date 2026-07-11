# MiroShark A/B Experiment Script

`ab_experiment.py` orchestrates small A/B experiments by preparing one parent
simulation, then testing each content variant through counterfactual branches
that reuse the parent's persona population.

## Quick Start

Reuse an existing prepared parent:

```bash
python backend/scripts/ab_experiment.py \
  --parent-id sim_existing \
  --variant A="Control copy" \
  --variant B="Treatment copy" \
  --replicates 3 \
  --parallel 2
```

Create a parent from scenario text:

```bash
python backend/scripts/ab_experiment.py \
  --scenario "How will users react to the launch?" \
  --variant A=@control.txt \
  --variant B=@treatment.txt
```

Resume a previous run:

```bash
python backend/scripts/ab_experiment.py --resume --out experiments/20260710T120000Z
```

## Inputs

- `--api-url`: defaults to `MIROSHARK_API_URL` or `http://localhost:5001`.
- `--internal-key`: defaults to `MIROSHARK_INTERNAL_KEY` and is sent as
  `x-miroshark-internal-key` on protected endpoints.
- `--parent-id`: reuse an existing prepared simulation.
- `--scenario` or `--scenario-file`: create a new parent. The script sends the
  text as `simulation_requirement` and as a synthetic `scenario.txt` document
  through `POST /api/graph/ontology/generate`.
- `--variant NAME=TEXT`: repeat at least twice. Use `NAME=@file.txt` to load
  variant text from disk.
- `--replicates`: branches per variant, default `3`.
- `--parallel`: max active branch simulations, default `2`.
- `--trigger-round`: counterfactual injection round, default `0`.
- `--out`: output directory, default `./experiments/<UTC timestamp>`.
- `--dry-run`: print the planned matrix and make no HTTP requests.
- `--resume`: load `<out>/state.json` and continue.

## Flow

1. Ensure the parent simulation is prepared and ready.
2. For each variant replicate, call `POST /api/simulation/branch-counterfactual`
   with `{parent_simulation_id, injection_text, trigger_round, label, branch_id}`.
3. Start each branch with `POST /api/simulation/start`, keeping at most
   `--parallel` branch runs active.
4. Poll `POST /api/simulation/batch-status` in chunks of 20. Because that
   endpoint is keyless and publish-gated, the script falls back to authenticated
   `GET /api/simulation/<id>/run-status` for hidden/private entries.
5. Fetch final metrics from `run-status`, `run-status/detail`, `belief-drift`,
   `demographics`, and `cost.json`.
6. Write `<out>/state.json` after every phase, then `<out>/results.json` and
   `<out>/report.md`.

## Statistics

The script compares variants on final bullish percentage from
`GET /api/simulation/<id>/belief-drift`.

- Per variant: mean, sample standard deviation, and 95% CI.
- CI critical values: embedded two-sided Student t values for df 1-30, else
  `1.96`.
- Pairwise comparison: Welch t-test against the first variant using the
  Welch-Satterthwaite degrees of freedom.
- Verdict: significant at approximately 5% or not significant.

Sample sizes are small; results are directional, not confirmatory.

## Outputs

- `state.json`: resumable execution state, updated after every phase.
- `results.json`: raw endpoint responses plus computed statistics.
- `report.md`: variant summary table, demographic winner table, simulation ids,
  per-run cost, and total available cost.

`cost.json` can still return unavailable or private errors depending on backend
publish-gate behavior. The script records that error per simulation instead of
failing the whole experiment.
