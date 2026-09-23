"""Shared fixtures exercise the supplied catalogue and isolated edge cases."""

import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.catalog import load_catalog


ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "data" / "contractors.csv"
FIELDS = (
    "id", "anon_name", "categories", "city", "city_imputed", "synthetic",
    "price_from_kzt", "price_imputed", "event_formats", "languages",
    "max_hours", "busy_dates", "description",
)
BASE_REQUEST = {
    "city": "Алматы", "event_date": "2026-10-15", "event_type": "корпоратив",
    "category": "Ведущий", "budget_kzt": 1_000_000,
    "duration_hours": None, "language": None,
}


@pytest.fixture
def query():
    return dict(BASE_REQUEST)


@pytest.fixture(scope="session")
def catalog():
    return load_catalog(DATA_PATH)


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(data_path=DATA_PATH, frontend_dir=tmp_path / "no-ui")) as api:
        yield api


@pytest.fixture
def write_catalog(tmp_path):
    """Create raw CSV, including malformed values, without changing supplied data."""
    sequence = 0

    def write(rows):
        nonlocal sequence
        sequence += 1
        path = tmp_path / f"catalog-{sequence}.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            for index, changes in enumerate(rows):
                row = {
                    "id": f"TEST-{index:03d}", "anon_name": "Тестовый ведущий",
                    "categories": "Ведущий", "city": "Алматы",
                    "city_imputed": "False", "synthetic": "True",
                    "price_from_kzt": "100", "price_imputed": "False",
                    "event_formats": "корпоратив", "languages": "русский",
                    "max_hours": "4", "busy_dates": "",
                    "description": "Проводит камерные корпоративные встречи с викторинами.",
                }
                row.update(changes)
                writer.writerow(row)
        return path

    return write
