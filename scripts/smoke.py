"""Exercise a running backend with real data; no third-party client required."""
import argparse
import json
from time import perf_counter
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def call(base, path, payload=None):
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(base.rstrip("/") + path, data=data,
                      headers={"Content-Type": "application/json"} if data else {})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


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
    empty = call(args.base_url, "/api/recommendations", {**query, "budget_kzt": 1})
    assert empty["status"] == "no_matches" and empty["message"]
    for suggestion in empty["suggestions"]:
        checked = call(args.base_url, "/api/recommendations", suggestion["request"])
        assert checked["eligible_count"] == suggestion["eligible_count"] > 0
    print(json.dumps({"status": "PASS", "dataset_count": 66, "dense_eligible": [6, 4],
                      "rare_eligible": 2, "empty_states": 2, "repeat_order": "stable",
                      "suggestions": len(empty["suggestions"]), "request_ms": round(elapsed * 1000, 2),
                      "first_date_ids": [c["id"] for c in response["cards"]],
                      "second_date_ids": [c["id"] for c in next_day["cards"]]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
