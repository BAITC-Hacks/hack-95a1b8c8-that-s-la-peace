"""Exercise a running backend with real data; no third-party client required."""
import argparse
import json
from time import perf_counter
from urllib.request import Request, urlopen


def call(base, path, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(base.rstrip("/") + path, data=data,
                      headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def verify_suggestions(base, query, response, version, required_kind):
    """Require the expected advice and exercise every proposed request over HTTP."""
    assert response["dataset_version"] == version, "Advice used another dataset"
    suggestions = response["suggestions"]
    assert sum(s["kind"] == required_kind for s in suggestions) == 1, required_kind
    changed_fields = {"change_date": "event_date", "increase_budget": "budget_kzt"}
    for suggestion in suggestions:
        field = changed_fields[suggestion["kind"]]
        changed = suggestion["request"]
        assert set(changed) == set(query), "Advice must preserve all request fields"
        assert {key for key in query if query[key] != changed[key]} == {field}, "Advice must change one field"
        if field == "budget_kzt":
            assert changed[field] > query[field], "Budget advice must increase the budget"
        checked = call(base, "/api/recommendations", changed)
        assert checked["dataset_version"] == version, "Follow-up used another dataset"
        assert checked["status"] == "matched"
        assert checked["eligible_count"] == suggestion["eligible_count"] > 0
        assert len(checked["cards"]) == min(3, checked["eligible_count"])
    return len(suggestions)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    health = call(args.base_url, "/api/health")
    assert health["status"] == "ok" and health["dataset_count"] == 66, health
    meta = call(args.base_url, "/api/meta")
    query = {"city": "Алматы", "event_date": "2026-10-15", "event_type": "корпоратив",
             "category": "Ведущий", "budget_kzt": 1000000, "duration_hours": None, "language": None}
    started = perf_counter()
    response = call(args.base_url, "/api/recommendations", query)
    elapsed = perf_counter() - started
    assert response["dataset_version"] == meta["dataset_version"]
    assert response["status"] == "matched" and response["eligible_count"] == 6
    assert len(response["cards"]) == 3 and elapsed < 10
    again = call(args.base_url, "/api/recommendations", query)
    assert [c["id"] for c in response["cards"]] == [c["id"] for c in again["cards"]]
    next_day = call(args.base_url, "/api/recommendations", {**query, "event_date": "2026-10-16"})
    assert next_day["eligible_count"] == 4
    assert [c["id"] for c in response["cards"]] != [c["id"] for c in next_day["cards"]]
    rare = call(args.base_url, "/api/recommendations", {**query, "category": "Флорист", "event_type": "свадьба"})
    assert rare["eligible_count"] == 2 and len(rare["cards"]) == 2
    absent = call(args.base_url, "/api/recommendations", {**query, "city": "Зарубежье"})
    assert absent["status"] == "no_category_in_city" and absent["message"]
    budget_query = {**query, "budget_kzt": 1}
    empty = call(args.base_url, "/api/recommendations", budget_query)
    assert empty["status"] == "no_matches" and empty["message"]
    budget_advice = verify_suggestions(args.base_url, budget_query, empty, meta["dataset_version"], "increase_budget")
    busy_query = {**query, "city": "Астана", "category": "Флорист", "event_type": "свадьба"}
    busy = call(args.base_url, "/api/recommendations", busy_query)
    assert busy["status"] == "no_matches" and busy["exclusions"]["busy"] > 0
    date_advice = verify_suggestions(args.base_url, busy_query, busy, meta["dataset_version"], "change_date")
    print(json.dumps({"status": "PASS", "dataset_count": 66, "dense_eligible": [6, 4],
                      "rare_eligible": 2, "empty_states": 2, "repeat_order": "stable",
                      "suggestions": budget_advice + date_advice,
                      "suggestion_kinds": ["increase_budget", "change_date"], "request_ms": round(elapsed * 1000, 2),
                      "first_date_ids": [c["id"] for c in response["cards"]],
                      "second_date_ids": [c["id"] for c in next_day["cards"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
