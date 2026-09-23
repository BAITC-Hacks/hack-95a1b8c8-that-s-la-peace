"""The quick smoke must reject missing or misleading alternative requests."""
import copy

import pytest

from backend.matching import recommend
from scripts import smoke


@pytest.mark.parametrize("kind", ["increase_budget", "change_date"])
def test_smoke_rejects_missing_expected_suggestion(monkeypatch, catalog, kind):
    def fake_call(base, path, payload=None):
        if path == "/api/health":
            return {"status": "ok", "dataset_count": 66}
        if path == "/api/meta":
            return catalog.meta()
        result = copy.deepcopy(recommend(catalog, payload))
        result["suggestions"] = [s for s in result["suggestions"] if s["kind"] != kind]
        return result
    monkeypatch.setattr(smoke, "call", fake_call)
    monkeypatch.setattr("sys.argv", ["smoke.py"])
    with pytest.raises(AssertionError):
        smoke.main()


@pytest.mark.parametrize("fault", ["second_field", "missing_field", "response_version", "followup_version", "wrong_count"])
def test_advice_verification_rejects_inconsistent_results(monkeypatch, catalog, query, fault):
    query["budget_kzt"] = 1
    response = copy.deepcopy(recommend(catalog, query))
    suggestion = next(s for s in response["suggestions"] if s["kind"] == "increase_budget")
    if fault == "second_field":
        suggestion["request"]["language"] = "русский"
    if fault == "missing_field":
        del suggestion["request"]["language"]
    if fault == "response_version":
        response["dataset_version"] = "0" * 64
    if fault == "wrong_count":
        suggestion["eligible_count"] += 1
    def fake_call(base, path, payload=None):
        result = recommend(catalog, payload)
        if fault == "followup_version":
            result["dataset_version"] = "0" * 64
        return result
    monkeypatch.setattr(smoke, "call", fake_call)
    with pytest.raises(AssertionError):
        smoke.verify_suggestions("unused", query, response, catalog.version, "increase_budget")


def test_smoke_accepts_real_catalogue_responses(monkeypatch, catalog, capsys):
    def fake_call(base, path, payload=None):
        if path == "/api/health":
            return {"status": "ok", "dataset_count": 66}
        if path == "/api/meta":
            return catalog.meta()
        return recommend(catalog, payload)
    monkeypatch.setattr(smoke, "call", fake_call)
    monkeypatch.setattr("sys.argv", ["smoke.py"])
    smoke.main()
    output = capsys.readouterr().out
    assert '"status": "PASS"' in output
    assert '"suggestion_kinds": ["increase_budget", "change_date"]' in output
