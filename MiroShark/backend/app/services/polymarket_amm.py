"""Read final simulated Polymarket AMM prices from a simulation directory.

The live chart endpoints in ``app.api.simulation`` read the SQLite
``market`` table and derive the YES price from constant-product AMM
reserves as ``reserve_b / (reserve_a + reserve_b)``. This module keeps
that same read logic available to service-layer export code without
importing Flask route handlers.
"""

from __future__ import annotations

import os
import sqlite3
from typing import Any, Optional

from ..config import Config


AMM_SOURCE = "simulated_amm"


def _plain_simulation_id(simulation_id: Any) -> Optional[str]:
    """Return a path-safe simulation id string, or ``None``."""
    if not isinstance(simulation_id, str):
        return None
    sim_id = simulation_id.strip()
    if not sim_id or os.path.isabs(sim_id):
        return None
    for sep in (os.sep, os.altsep):
        if sep and sep in sim_id:
            return None
    if ".." in sim_id:
        return None
    return sim_id


def polymarket_db_path(simulation_id: Any) -> Optional[str]:
    """Resolve the Polymarket DB path for a simulation if it exists.

    Mirrors the endpoint resolver's two supported layouts:
    ``<sim_dir>/polymarket_simulation.db`` and the older nested
    ``<sim_dir>/polymarket/polymarket.db``.
    """
    sim_id = _plain_simulation_id(simulation_id)
    if sim_id is None:
        return None

    sim_dir = os.path.join(Config.WONDERWALL_SIMULATION_DATA_DIR, sim_id)
    candidates = [
        os.path.join(sim_dir, "polymarket_simulation.db"),
        os.path.join(sim_dir, "polymarket", "polymarket.db"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _float_or_zero(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    if parsed != parsed:
        return 0.0
    return parsed


def _clamp_probability(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 1.0:
        return 1.0
    return value


def _sort_key(market: dict[str, Any]) -> tuple[int, int]:
    try:
        trade_count = int(market.get("trade_count", 0) or 0)
    except (TypeError, ValueError):
        trade_count = 0
    try:
        market_id = int(market.get("market_id", 0) or 0)
    except (TypeError, ValueError):
        market_id = 0
    return -trade_count, market_id


def load_final_amm_market(simulation_id: Any) -> Optional[dict[str, Any]]:
    """Return the final traded AMM market snapshot, or ``None``.

    Graceful degradation is intentional: missing Polymarket platform,
    no DB, no trades, unreadable SQLite, or unexpected schema all return
    ``None``. When multiple markets have trades, the most-traded market
    is used, with the smallest ``market_id`` as a deterministic tie-break.
    """
    db_path = polymarket_db_path(simulation_id)
    if not db_path:
        return None

    try:
        with sqlite3.connect(db_path) as con:
            cur = con.cursor()
            rows = cur.execute(
                "SELECT market_id, question, outcome_a, outcome_b, "
                "reserve_a, reserve_b, resolved, winning_outcome, created_at "
                "FROM market ORDER BY market_id"
            ).fetchall()
            trade_counts = dict(
                cur.execute(
                    "SELECT market_id, COUNT(*) FROM trade GROUP BY market_id"
                ).fetchall()
            )
    except (OSError, sqlite3.Error, TypeError, ValueError):
        return None

    markets: list[dict[str, Any]] = []
    for (
        market_id,
        question,
        outcome_a,
        outcome_b,
        reserve_a,
        reserve_b,
        resolved,
        winning_outcome,
        created_at,
    ) in rows:
        try:
            trade_count = int(trade_counts.get(market_id, 0) or 0)
        except (TypeError, ValueError):
            trade_count = 0
        if trade_count <= 0:
            continue

        ra = _float_or_zero(reserve_a)
        rb = _float_or_zero(reserve_b)
        total = ra + rb
        price_yes = (rb / total) if total > 0.0 else 0.5
        markets.append(
            {
                "market_id": market_id,
                "question": question,
                "outcome_a": outcome_a,
                "outcome_b": outcome_b,
                "price_yes": round(_clamp_probability(price_yes), 4),
                "reserve_a": reserve_a,
                "reserve_b": reserve_b,
                "resolved": bool(resolved),
                "winning_outcome": winning_outcome,
                "trade_count": trade_count,
                "created_at": created_at,
            }
        )

    if not markets:
        return None

    markets.sort(key=_sort_key)
    return markets[0]


def load_final_amm_yes_probability(simulation_id: Any) -> Optional[float]:
    """Return the final YES probability from the simulated AMM, or ``None``."""
    market = load_final_amm_market(simulation_id)
    if market is None:
        return None
    value = market.get("price_yes")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None
