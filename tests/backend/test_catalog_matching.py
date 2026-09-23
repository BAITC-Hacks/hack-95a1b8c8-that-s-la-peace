"""Data invariants and independent selection scenarios, not implementation details."""

import csv
import hashlib

import pytest

from backend.catalog import load_catalog
from backend.matching import recommend
from conftest import DATA_PATH


def ids(response):
    return [card["id"] for card in response["cards"]]


def test_source_catalogue_is_preserved_and_normalized(catalog):
    assert len(catalog.profiles) == 66
    assert len({p["id"] for p in catalog.profiles}) == 66
    assert sum(p["synthetic"] for p in catalog.profiles) == 13
    assert sum(p["max_hours"] is None for p in catalog.profiles) == 9
    assert catalog.version == hashlib.sha256(DATA_PATH.read_bytes()).hexdigest()
    for profile in catalog.profiles:
        for field in ("categories", "event_formats", "languages"):
            assert isinstance(profile[field], tuple) and profile[field]
        assert isinstance(profile["busy_dates"], frozenset)
        assert type(profile["price_from_kzt"]) is int
        for field in ("synthetic", "city_imputed", "price_imputed"):
            assert type(profile[field]) is bool


@pytest.mark.parametrize("changes,eligible,status", [
    ({}, 6, "matched"),
    ({"event_date": "2026-10-16"}, 4, "matched"),
    ({"category": "Флорист", "event_type": "свадьба"}, 2, "matched"),
    ({"city": "Астана", "category": "Флорист", "event_type": "свадьба"}, 0, "no_matches"),
    ({"budget_kzt": 1}, 0, "no_matches"),
    ({"city": "Зарубежье"}, 0, "no_category_in_city"),
])
def test_known_real_catalogue_scenarios(catalog, query, changes, eligible, status):
    response = recommend(catalog, {**query, **changes})
    assert response["eligible_count"] == eligible
    assert response["status"] == status
    assert len(response["cards"]) == min(3, eligible)
    assert response["message"].strip()
    if status == "no_category_in_city":
        assert response["total_in_city_category"] == 0
        assert all(count == 0 for count in response["exclusions"].values())
        assert response["suggestions"] == []


def test_optional_missing_and_null_have_identical_results(catalog, query):
    omitted = {key: value for key, value in query.items() if key not in {"language", "duration_hours"}}
    assert recommend(catalog, omitted) == recommend(catalog, query)


def test_exclusions_overlap_and_are_not_short_circuited(write_catalog, query):
    source = write_catalog([
        {"id": "GOOD", "price_from_kzt": "100", "max_hours": "4"},
        {"id": "BAD", "price_from_kzt": "101", "busy_dates": "2026-10-15",
         "event_formats": "свадьба", "languages": "английский", "max_hours": "3"},
        {"id": "OTHER-CITY", "city": "Астана", "busy_dates": "2026-10-15"},
    ])
    response = recommend(load_catalog(source), {**query, "budget_kzt": 100, "duration_hours": 4, "language": "русский"})
    assert ids(response) == ["GOOD"]
    assert response["total_in_city_category"] == 2
    assert response["exclusions"] == {"busy": 1, "budget": 1, "event_type": 1, "language": 1, "duration": 1}


def test_busy_venues_are_excluded(write_catalog, query):
    source = write_catalog([
        {"id": "BUSY-VENUE", "categories": "Площадка", "busy_dates": query["event_date"]},
        {"id": "FREE-VENUE", "categories": "Площадка"},
    ])
    response = recommend(load_catalog(source), {**query, "category": "Площадка"})
    assert ids(response) == ["FREE-VENUE"]
    assert response["exclusions"]["busy"] == 1


def test_null_duration_is_not_zero_or_a_hidden_filter(write_catalog, query):
    source = write_catalog([{"max_hours": "", "categories": "Флорист"}])
    response = recommend(load_catalog(source), {**query, "category": "Флорист", "duration_hours": 100})
    assert response["eligible_count"] == 1
    assert response["cards"][0]["max_hours"] is None
    assert response["exclusions"]["duration"] == 0


def test_rank_ties_use_id_and_ignore_csv_order(write_catalog, query):
    rows = [{"id": profile_id} for profile_id in ("D", "A", "C", "B")]
    first = load_catalog(write_catalog(rows))
    reversed_catalog = load_catalog(write_catalog(list(reversed(rows))))
    assert ids(recommend(first, query)) == ["A", "B", "C"]
    assert ids(recommend(reversed_catalog, query)) == ["A", "B", "C"]
    assert ids(recommend(load_catalog(write_catalog(rows)), query)) == ["A", "B", "C"]


def test_real_catalogue_order_does_not_control_ranking(catalog, query, tmp_path):
    with DATA_PATH.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        fields, rows = reader.fieldnames, list(reader)
    shuffled_path = tmp_path / "reverse.csv"
    with shuffled_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(reversed(rows))
    response = recommend(catalog, query)
    assert ids(recommend(load_catalog(shuffled_path), query)) == ids(response)
    assert recommend(catalog, query) == response
    assert response["suggestions"] == []


def test_card_facts_and_provenance_come_from_source(catalog, query):
    profiles = {p["id"]: p for p in catalog.profiles}
    for card in recommend(catalog, query)["cards"]:
        source = profiles[card["id"]]
        assert card["name"] == source["anon_name"]
        assert card["category"] in source["categories"]
        assert card["city"] == source["city"]
        assert card["price_from_kzt"] == source["price_from_kzt"]
        assert card["languages"] == list(source["languages"])
        assert card["description_excerpt"].strip()
        assert card["description_excerpt"] in source["description"]
        assert card["explanation"].strip()
        for field in ("max_hours", "synthetic", "city_imputed", "price_imputed"):
            assert card[field] == source[field]
        assert card["source"] == "provided"


def test_suggestions_change_one_field_and_choose_minimal_alternatives(write_catalog, query):
    source = write_catalog([
        {"id": "DATE", "busy_dates": "2026-10-15", "price_from_kzt": "100"},
        {"id": "BUDGET", "price_from_kzt": "180"},
        {"id": "COSTLIER", "price_from_kzt": "250"},
    ])
    loaded = load_catalog(source)
    request = {**query, "budget_kzt": 100}
    response = recommend(loaded, request)
    assert response["status"] == "no_matches"
    assert [s["kind"] for s in response["suggestions"]] == ["change_date", "increase_budget"]
    for suggestion in response["suggestions"]:
        alternative = suggestion["request"]
        assert set(alternative) == set(request)
        changed = [key for key in request if request[key] != alternative[key]]
        assert len(changed) == 1
        if suggestion["kind"] == "change_date":
            assert changed == ["event_date"]
            assert alternative["event_date"] == "2026-10-14"
        else:
            assert changed == ["budget_kzt"]
            assert alternative["budget_kzt"] == 180
        actual = recommend(loaded, alternative)
        assert actual["eligible_count"] == suggestion["eligible_count"] > 0
        assert actual["suggestions"] == []
        assert suggestion["message"].strip()


def test_no_suggestion_when_two_changes_would_be_needed(write_catalog, query):
    source = write_catalog([{"price_from_kzt": "200", "busy_dates": "2026-10-15"}])
    response = recommend(load_catalog(source), {**query, "budget_kzt": 100})
    assert response["status"] == "no_matches"
    assert response["suggestions"] == []


@pytest.mark.parametrize("bad_row", [
    {"price_from_kzt": "not-a-number"}, {"price_from_kzt": "-1"},
    {"synthetic": "perhaps"}, {"busy_dates": "2026-02-30"},
    {"max_hours": "0"}, {"categories": ""}, {"id": ""},
])
def test_invalid_source_values_fail_loading(write_catalog, bad_row):
    with pytest.raises(ValueError):
        load_catalog(write_catalog([bad_row]))


def test_duplicate_ids_and_empty_catalogue_fail_loading(write_catalog):
    for rows in ([{"id": "SAME"}, {"id": "SAME"}], []):
        with pytest.raises(ValueError):
            load_catalog(write_catalog(rows))

@pytest.mark.parametrize("row_changes,reason", [
    ({"busy_dates": "2026-10-15"}, "busy"),
    ({"price_from_kzt": "101"}, "budget"),
    ({"event_formats": "свадьба"}, "event_type"),
    ({"languages": "английский"}, "language"),
    ({"max_hours": "3"}, "duration"),
])
def test_each_hard_constraint_alone_removes_a_candidate(write_catalog, query, row_changes, reason):
    loaded = load_catalog(write_catalog([row_changes]))
    response = recommend(loaded, {**query, "budget_kzt": 100, "language": "русский", "duration_hours": 4})
    assert response["status"] == "no_matches"
    assert response["cards"] == []
    assert response["exclusions"][reason] == 1
    assert sum(response["exclusions"].values()) == 1

@pytest.mark.parametrize("busy_date,expected_date", [
    ("2026-09-23", "2026-09-24"),
    ("2026-12-31", "2026-12-30"),
])
def test_date_suggestion_stays_inside_calendar_at_both_boundaries(write_catalog, query, busy_date, expected_date):
    loaded = load_catalog(write_catalog([{"busy_dates": busy_date}]))
    request = {**query, "event_date": busy_date, "budget_kzt": 100}
    response = recommend(loaded, request)
    assert response["status"] == "no_matches"
    assert len(response["suggestions"]) == 1
    suggestion = response["suggestions"][0]
    assert suggestion["kind"] == "change_date"
    assert suggestion["request"]["event_date"] == expected_date
    assert "2026-09-23" <= expected_date <= "2026-12-31"
    assert recommend(loaded, suggestion["request"])["eligible_count"] == suggestion["eligible_count"] == 1


def test_real_date_change_alters_visible_top_three_due_to_availability(catalog, query):
    first = recommend(catalog, {**query, "event_date": "2026-10-15"})
    second = recommend(catalog, {**query, "event_date": "2026-10-16"})
    assert len(first["cards"]) == len(second["cards"]) == 3
    assert ids(first) != ids(second)
    profiles = {profile["id"]: profile for profile in catalog.profiles}
    assert any("2026-10-16" in profiles[profile_id]["busy_dates"] for profile_id in ids(first)) or any(
        "2026-10-15" in profiles[profile_id]["busy_dates"] for profile_id in ids(second)
    )
    for response, event_date in ((first, "2026-10-15"), (second, "2026-10-16")):
        assert all(event_date not in profiles[card["id"]]["busy_dates"] for card in response["cards"])


def test_explanations_include_distinct_source_facts_not_only_names(write_catalog, query):
    source = write_catalog([
        {"id": "QUIZ", "anon_name": "Участник Один", "description": "Проводит камерные корпоративные встречи с авторскими викторинами."},
        {"id": "MUSIC", "anon_name": "Участник Два", "description": "Ведёт корпоративные вечера с живым вокалом и акустической гитарой."},
    ])
    loaded = load_catalog(source)
    cards = recommend(loaded, query)["cards"]
    assert len(cards) == 2
    profiles = {profile["id"]: profile for profile in loaded.profiles}
    for card in cards:
        assert card["description_excerpt"] in profiles[card["id"]]["description"]
        assert card["description_excerpt"] in card["explanation"]
    without_names = [card["explanation"].replace(card["name"], "").strip() for card in cards]
    assert len(set(without_names)) == 2
    assert len({card["description_excerpt"] for card in cards}) == 2
