"""Build the UI's aggregate catalog guide using only the Python standard library.

Run from any directory: python frontend/generate-guide.py
Verify the committed output without rewriting it: python frontend/generate-guide.py --check

This is descriptive data, not a recommendation response. Groups use only city,
category, event format and (for calendar entries) availability on the given date.
Budget, language, duration, ranking and explanations are deliberately not applied.
No profile identifiers, names, descriptions or event links enter the output.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
from datetime import date, timedelta
import hashlib
import io
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "contractors.csv"
OUTPUT = Path(__file__).with_name("catalog-guide.json")
DATE_MIN = date(2026, 9, 23)
DATE_MAX = date(2026, 12, 31)
DATES = tuple(
    (DATE_MIN + timedelta(days=offset)).isoformat()
    for offset in range((DATE_MAX - DATE_MIN).days + 1)
)
COLUMNS = {
    "id", "anon_name", "categories", "city", "city_imputed", "synthetic",
    "price_from_kzt", "price_imputed", "event_formats", "languages",
    "max_hours", "busy_dates", "description",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def read_rows(raw: bytes) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
    fields = reader.fieldnames or []
    require(len(fields) == len(COLUMNS) and set(fields) == COLUMNS,
            "CSV columns must match the 13-field supplied catalog.")
    rows = list(reader)
    require(len(rows) == 66, "Expected all 66 supplied profiles; do not silently omit rows.")
    require(all(None not in row and all(value is not None for value in row.values())
                for row in rows), "CSV contains a row with missing or extra columns.")
    return rows


def split_list(value: str, field: str) -> tuple[str, ...]:
    items = tuple(part.strip() for part in value.split("|"))
    require(all(items), f"Empty item in {field}.")
    return tuple(sorted(set(items)))


def positive_integer(value: str, field: str) -> int:
    require(re.fullmatch(r"[0-9]+", value) is not None and int(value) > 0,
            f"{field} must be a positive integer.")
    return int(value)


def load_profiles(raw: bytes) -> list[dict]:
    profiles = []
    seen = set()
    for line, source in enumerate(read_rows(raw), start=2):
        row = {key: value.strip() for key, value in source.items()}
        for field in ("id", "anon_name", "city", "description"):
            require(bool(row[field]), f"Required field {field} missing on CSV row {line}.")
        require(row["id"] not in seen, f"Duplicate profile id on CSV row {line}.")
        seen.add(row["id"])
        for field in ("synthetic", "city_imputed", "price_imputed"):
            require(row[field] in {"True", "False"}, f"Invalid {field} on CSV row {line}.")
        split_list(row["languages"], "languages")
        if row["max_hours"]:
            positive_integer(row["max_hours"], "max_hours")
        busy = frozenset(split_list(row["busy_dates"], "busy_dates")) if row["busy_dates"] else frozenset()
        require(busy.issubset(DATES), f"Busy date outside the 100-day calendar on CSV row {line}.")
        profiles.append({
            "city": row["city"],
            "categories": split_list(row["categories"], "categories"),
            "event_formats": split_list(row["event_formats"], "event_formats"),
            "price": positive_integer(row["price_from_kzt"], "price_from_kzt"),
            "busy": busy,
        })
    require(len(seen) == 66, "Expected 66 unique profiles.")
    return profiles


def price_range(prices: list[int]) -> dict[str, int | None]:
    return {
        "price_min": min(prices) if prices else None,
        "price_max": max(prices) if prices else None,
    }


def build_guide(profiles: list[dict], version: str) -> dict:
    members = defaultdict(list)
    for profile in profiles:
        for category in profile["categories"]:
            for event_type in profile["event_formats"]:
                members[(profile["city"], category, event_type)].append(profile)
    groups = []
    for (city, category, event_type), records in sorted(members.items()):
        calendar = {}
        for day in DATES:
            prices = [profile["price"] for profile in records if day not in profile["busy"]]
            calendar[day] = {"available": len(prices), **price_range(prices)}
        groups.append({
            "city": city,
            "category": category,
            "event_type": event_type,
            "total": len(records),
            **price_range([profile["price"] for profile in records]),
            "dates": calendar,
        })
    return {
        "dataset_version": version,
        "date_range": {"min": DATES[0], "max": DATES[-1]},
        "city_counts": dict(sorted(Counter(profile["city"] for profile in profiles).items())),
        "groups": groups,
    }


def encode(guide: dict) -> bytes:
    return (json.dumps(guide, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def verify(raw: bytes, profiles: list[dict], guide: dict, encoded: bytes) -> None:
    require(len(DATES) == 100, "The declared calendar must cover exactly 100 days.")
    require(sum(guide["city_counts"].values()) == 66, "City totals must count all profiles once.")
    for group in guide["groups"]:
        require(tuple(group["dates"]) == DATES, "Every group must contain the full calendar.")
        for stats in group["dates"].values():
            require(0 <= stats["available"] <= group["total"], "Invalid availability count.")
            if stats["available"]:
                require(0 < stats["price_min"] <= stats["price_max"], "Invalid available price range.")
            else:
                require(stats["price_min"] is None and stats["price_max"] is None,
                        "Unavailable dates must have null price bounds.")

    # Independent direct-CSV check of the dense-category demo group and date.
    direct = [row for row in read_rows(raw)
              if row["city"].strip() == "Алматы"
              and "Ведущий" in [value.strip() for value in row["categories"].split("|")]
              and "корпоратив" in [value.strip() for value in row["event_formats"].split("|")]]
    group = next(item for item in guide["groups"]
                 if (item["city"], item["category"], item["event_type"])
                 == ("Алматы", "Ведущий", "корпоратив"))
    all_prices = [int(row["price_from_kzt"]) for row in direct]
    available_prices = [int(row["price_from_kzt"]) for row in direct
                        if "2026-10-15" not in [value.strip() for value in row["busy_dates"].split("|")]]
    require(group["total"] == len(direct), "Demo group total differs from the CSV.")
    require({key: group[key] for key in ("price_min", "price_max")} == price_range(all_prices),
            "Demo group price range differs from the CSV.")
    require(group["dates"]["2026-10-15"] == {
        "available": len(available_prices), **price_range(available_prices),
    }, "Demo date availability differs from the CSV.")
    require(encode(build_guide(list(reversed(profiles)), guide["dataset_version"])) == encoded,
            "Generated output must be independent of input row order.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify the existing JSON without writing")
    args = parser.parse_args()
    raw = SOURCE.read_bytes()
    profiles = load_profiles(raw)
    guide = build_guide(profiles, hashlib.sha256(raw).hexdigest())
    encoded = encode(guide)
    verify(raw, profiles, guide, encoded)
    if args.check:
        require(OUTPUT.is_file() and OUTPUT.read_bytes() == encoded,
                "catalog-guide.json is missing or stale; run frontend/generate-guide.py.")
    else:
        OUTPUT.write_bytes(encoded)
    action = "Verified" if args.check else "Generated"
    print(f"{action} catalog-guide.json: {len(profiles)} profiles, {len(guide['groups'])} groups, "
          f"{len(DATES)} dates/group, {len(encoded)} bytes.")
    print("PASS: schema, unique profiles, city totals, calendar, price bounds, direct-CSV demo, deterministic output.")
    print(f"dataset_version: {guide['dataset_version']}")


if __name__ == "__main__":
    main()
