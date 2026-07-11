"""Unit tests for demographic grounding — pure offline.

Covers the three pieces of the optional feature stack:

  1. ``country_registry`` — JSON pack loader + public-safe summary.
  2. ``demographic_sampler`` — graceful no-op when deps/dataset missing,
     prompt-block formatting, entity↔seed pairing.
  3. ``WonderwallProfileGenerator(country_code='xx')`` — smoke check
     that the generator still produces normal output when the sampler
     returns an empty seed list (unknown country / missing duckdb).

These are the surfaces operators rely on to keep the feature additive:
turning it on must never break a graph-only persona run.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))


class _FakeFetchAllResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _FakeDataFrame:
    def __init__(self, rows):
        self._rows = rows

    def to_dict(self, orient):
        assert orient == "records"
        return self._rows


class _FakeFetchDfResult:
    def __init__(self, rows):
        self._rows = rows

    def fetch_df(self):
        return _FakeDataFrame(self._rows)


class _FakeDuckDbConnection:
    def __init__(self, columns, rows):
        self.columns = columns
        self.rows = rows
        self.queries = []
        self.closed = False

    def execute(self, query):
        self.queries.append(query)
        if query.lstrip().upper().startswith("DESCRIBE"):
            return _FakeFetchAllResult([(col,) for col in self.columns])
        return _FakeFetchDfResult(self.rows)

    def close(self):
        self.closed = True


class _FakeDuckDb:
    def __init__(self, conn):
        self.conn = conn

    def connect(self):
        return self.conn


# ---------------------------------------------------------------------------
# country_registry
# ---------------------------------------------------------------------------

def test_country_registry_loads_shipped_packs():
    from app.services import country_registry

    countries = country_registry.all_countries(refresh=True)
    assert "sg" in countries, "Singapore pack missing"
    assert "us" in countries, "USA pack missing"
    assert "vn" in countries, "Vietnam pack missing"

    sg = countries["sg"]
    assert sg["name"] == "Singapore"
    assert sg["geography"]["field"] == "planning_area"
    assert len(sg["geography"]["values"]) >= 30
    # Group presets are the multi-region shortcut the frontend will offer.
    assert "north-east" in sg["geography"]["groups"]


def test_vietnam_country_pack_schema():
    from app.services import country_registry

    vn = country_registry.get("vn")
    assert vn is not None
    assert vn["code"] == "vn"
    assert vn["name"] == "Vietnam"
    assert vn["dataset"]["repo_id"] == "nvidia/Nemotron-Personas-Vietnam"
    assert vn["dataset"]["local_paths"] == [
        "backend/data/nemotron/vietnam/data/train-*.parquet",
        "backend/data/nemotron/data/train-*.parquet",
    ]
    assert vn["dataset"]["download_dir"] == "backend/data/nemotron/vietnam"
    assert vn["dataset"]["allow_patterns"] == ["data/train-*", "README.md"]
    assert vn["dataset"]["country_values"] == ["Việt Nam", "vietnam", "viet nam", "vn"]

    geo = vn["geography"]
    assert geo["field"] == "region"
    assert geo["label"] == "Province/City"
    assert geo["values"] == [
        "Thủ Đô Hà Nội",
        "Thành Phố Hải Phòng",
        "Thành Phố Đà Nẵng",
        "Thành Phố Hồ Chí Minh",
        "Tỉnh Đồng Nai",
        "Thành Phố Cần Thơ",
    ]
    assert geo["groups"] == {
        "north": ["Thủ Đô Hà Nội", "Thành Phố Hải Phòng"],
        "central": ["Thành Phố Đà Nẵng"],
        "south": ["Thành Phố Hồ Chí Minh", "Tỉnh Đồng Nai", "Thành Phố Cần Thơ"],
    }

    fields = {entry["field"]: entry for entry in vn["filter_fields"]}
    assert fields["age"] == {
        "field": "age",
        "type": "range",
        "label": "Age Range",
        "default_min": 18,
        "default_max": 65,
    }
    assert fields["region"]["type"] == "multi-chips"
    assert fields["occupation"]["type"] == "dropdown"
    assert fields["education_level"]["type"] == "dropdown"
    assert fields["zone"] == {
        "field": "zone",
        "type": "single-chips",
        "label": "Zone (Urban/Rural)",
    }
    assert fields["sex"]["type"] == "single-chips"
    assert "industry" not in fields
    assert vn["max_agents"] == 500
    assert vn["default_agents"] == 250


def test_country_registry_summary_omits_dataset_paths():
    """list_summaries() is what the public /api/countries endpoint exposes.
    It must not leak HF repo ids or local parquet paths."""
    from app.services import country_registry

    summaries = country_registry.list_summaries()
    assert len(summaries) >= 3
    sg_summary = next(s for s in summaries if s["code"] == "sg")
    vn_summary = next(s for s in summaries if s["code"] == "vn")
    forbidden = {"dataset", "repo_id", "local_paths", "download_dir"}
    assert forbidden.isdisjoint(sg_summary.keys()), (
        f"summary leaks internal fields: {sg_summary}"
    )
    assert forbidden.isdisjoint(vn_summary.keys()), (
        f"summary leaks internal fields: {vn_summary}"
    )
    # The fields the SPA actually needs.
    assert {"code", "name", "flag_emoji", "geography_field",
            "geography_label", "geography_count"}.issubset(sg_summary.keys())
    assert vn_summary["geography_field"] == "region"
    assert vn_summary["geography_count"] == 6


def test_country_registry_lookup_is_case_insensitive():
    from app.services import country_registry

    assert country_registry.get("SG") is not None
    assert country_registry.get("  us  ") is not None
    assert country_registry.get("xx") is None
    assert country_registry.get("") is None


# ---------------------------------------------------------------------------
# demographic_sampler — pure functions
# ---------------------------------------------------------------------------

def test_format_seed_for_prompt_filters_internal_keys():
    from app.services import demographic_sampler

    seed = {
        "age": 34,
        "sex": "female",
        "occupation": "teacher",
        "planning_area": "Tampines",
        "education_level": "bachelor",
        "industry": "education",
        "income_bracket": "$60-80k",
        # Internal/sentinel keys that should be stripped or normalized.
        "_geography_field": "planning_area",
        "_geography_value": "Tampines",
        "uuid": "should-not-appear",
        "irrelevant_field": "skip me",
        "empty_field": "",
        "nan_field": "nan",
    }
    rendered = demographic_sampler.format_seed_for_prompt(seed)

    assert "age: 34" in rendered
    assert "sex: female" in rendered
    assert "occupation: teacher" in rendered
    assert "planning_area: Tampines" in rendered
    # Internal-only keys must not leak into the LLM prompt.
    assert "uuid" not in rendered
    assert "should-not-appear" not in rendered
    assert "_geography_field" not in rendered
    # Empty / 'nan' values are skipped.
    assert "empty_field" not in rendered
    assert "nan_field" not in rendered


def test_format_seed_for_prompt_handles_empty_input():
    from app.services import demographic_sampler

    assert demographic_sampler.format_seed_for_prompt({}) == ""
    assert demographic_sampler.format_seed_for_prompt(None) == ""  # type: ignore[arg-type]


def test_pair_entities_with_seeds_exact_match():
    from app.services import demographic_sampler

    seeds = [{"age": 20}, {"age": 30}, {"age": 40}]
    pairs = demographic_sampler.pair_entities_with_seeds(3, seeds)
    assert len(pairs) == 3
    assert all(p is not None for p in pairs)
    # Deterministic shuffle: every seed must appear exactly once.
    paired_ages = sorted(p["age"] for p in pairs)
    assert paired_ages == [20, 30, 40]


def test_pair_entities_with_seeds_short_pool_pads_with_none():
    """When N seeds < N entities, surplus entities fall through to
    graph-only generation (None slots)."""
    from app.services import demographic_sampler

    seeds = [{"age": 20}, {"age": 30}]
    pairs = demographic_sampler.pair_entities_with_seeds(5, seeds)
    assert len(pairs) == 5
    assert sum(1 for p in pairs if p is not None) == 2
    assert sum(1 for p in pairs if p is None) == 3


def test_pair_entities_with_seeds_empty_pool_returns_all_none():
    from app.services import demographic_sampler

    pairs = demographic_sampler.pair_entities_with_seeds(4, [])
    assert pairs == [None, None, None, None]


# ---------------------------------------------------------------------------
# demographic_sampler.sample_seeds — graceful degradation
# ---------------------------------------------------------------------------

def test_sample_seeds_unknown_country_returns_empty():
    from app.services import demographic_sampler

    assert demographic_sampler.sample_seeds("xx", limit=5) == []


def test_sample_seeds_zero_limit_short_circuits():
    from app.services import demographic_sampler

    assert demographic_sampler.sample_seeds("sg", limit=0) == []
    assert demographic_sampler.sample_seeds("sg", limit=-3) == []


def test_sample_seeds_missing_duckdb_returns_empty():
    """When duckdb isn't importable the sampler must warn and return [],
    not crash — this is the path operators hit before installing the
    optional deps."""
    from app.services import demographic_sampler

    with patch.object(demographic_sampler, "_try_import_duckdb", return_value=None):
        assert demographic_sampler.sample_seeds("sg", limit=10) == []


def test_sample_seeds_missing_parquet_returns_empty():
    """duckdb installed but no parquet snapshot reachable → empty list,
    no exception."""
    from app.services import demographic_sampler

    fake_duckdb = MagicMock()
    with patch.object(demographic_sampler, "_try_import_duckdb", return_value=fake_duckdb), \
         patch.object(demographic_sampler, "_resolve_parquet_glob", return_value=None):
        assert demographic_sampler.sample_seeds("sg", limit=10) == []
        # Must not have attempted any query.
        fake_duckdb.connect.assert_not_called()


def test_sample_seeds_applies_country_values_with_vietnamese_diacritics():
    from app.services import demographic_sampler

    conn = _FakeDuckDbConnection(
        columns=["uuid", "country", "region", "sex", "age"],
        rows=[{
            "uuid": "seed-1",
            "country": "Việt Nam",
            "region": "Thủ Đô Hà Nội",
            "sex": "Nữ",
            "age": 30,
        }],
    )
    with patch.object(demographic_sampler, "_try_import_duckdb", return_value=_FakeDuckDb(conn)), \
         patch.object(demographic_sampler, "_resolve_parquet_glob", return_value="dummy.parquet"):
        rows = demographic_sampler.sample_seeds("vn", limit=1)

    assert rows[0]["_geography_field"] == "region"
    assert rows[0]["_geography_value"] == "Thủ Đô Hà Nội"
    query = conn.queries[-1]
    assert 'CAST("country" AS VARCHAR) IN (\'Việt Nam\', \'vietnam\', \'viet nam\', \'vn\')' in query
    assert 'lower(CAST("country" AS VARCHAR)) IN (\'việt nam\', \'vietnam\', \'viet nam\', \'vn\')' in query


def test_sample_seeds_skips_missing_industry_column():
    from app.services import demographic_sampler

    conn = _FakeDuckDbConnection(
        columns=["uuid", "country", "region", "occupation", "age"],
        rows=[{
            "uuid": "seed-1",
            "country": "Việt Nam",
            "region": "Thành Phố Hồ Chí Minh",
            "occupation": "Nhân viên văn phòng",
            "age": 42,
        }],
    )
    with patch.object(demographic_sampler, "_try_import_duckdb", return_value=_FakeDuckDb(conn)), \
         patch.object(demographic_sampler, "_resolve_parquet_glob", return_value="dummy.parquet"):
        rows = demographic_sampler.sample_seeds(
            "vn",
            limit=1,
            occupations=["Nhân viên văn phòng"],
            industries=["Sản xuất"],
        )

    assert rows
    query = conn.queries[-1]
    assert '"occupation"' in query
    assert '"industry"' not in query
    assert "Sản xuất" not in query


def test_infer_filter_schema_no_deps_returns_empty():
    from app.services import demographic_sampler

    with patch.object(demographic_sampler, "_try_import_duckdb", return_value=None):
        assert demographic_sampler.infer_filter_schema("sg") == []


# ---------------------------------------------------------------------------
# WonderwallProfileGenerator wiring — feature must stay additive
# ---------------------------------------------------------------------------

def test_generator_with_unknown_country_falls_back_to_graph_only():
    """The key invariant: passing country_code='xx' (or any code the
    sampler can't satisfy) must not break the persona pipeline. The
    seed map stays empty and entities flow through the existing prompt
    path."""
    # Heavy imports — pull lazily so the other tests in this file stay
    # fast offline regardless of the generator's transitive deps.
    pytest.importorskip("camel")  # camel-ai is a transitive runtime dep

    from app.services.wonderwall_profile_generator import WonderwallProfileGenerator

    # __init__ eagerly builds an LLM client (needs LLM_API_KEY); that client is
    # irrelevant to this demographic-wiring check, so stub its construction out.
    with patch("app.services.wonderwall_profile_generator.create_llm_client"):
        gen = WonderwallProfileGenerator(country_code="xx")
    assert gen.country_code == "xx"
    # The pre-sim map is populated only when the sampler returns rows.
    # With an unknown country it stays empty and the worker thread sees
    # demographic_seed=None — i.e. the pre-feature code path.
    assert gen._demographic_seeds_by_user_id == {}


def test_generator_no_country_means_feature_off():
    pytest.importorskip("camel")

    from app.services.wonderwall_profile_generator import WonderwallProfileGenerator

    # No env var, no kwarg → feature is off, country_code is None.
    with patch.dict("os.environ", {"DEMOGRAPHICS_COUNTRY": ""}, clear=False):
        # Re-import config to pick up the env override.
        from app import config as _cfg
        _cfg.Config.DEMOGRAPHICS_COUNTRY = ""
        with patch("app.services.wonderwall_profile_generator.create_llm_client"):
            gen = WonderwallProfileGenerator()
        assert gen.country_code is None
        assert gen._demographic_seeds_by_user_id == {}


def test_reddit_gender_normalization_handles_vietnamese_values():
    pytest.importorskip("camel")

    from app.services.wonderwall_profile_generator import WonderwallProfileGenerator

    gen = object.__new__(WonderwallProfileGenerator)
    assert gen._normalize_gender("Nam") == "male"
    assert gen._normalize_gender("Nữ") == "female"
    assert gen._normalize_gender("nu") == "female"
