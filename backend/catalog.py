"""Read and validate the supplied CSV without modifying source records."""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

DATE_MIN = "2026-09-23"
DATE_MAX = "2026-12-31"
REQUIRED_COLUMNS = (
    "id", "anon_name", "categories", "city", "city_imputed", "synthetic",
    "price_from_kzt", "price_imputed", "event_formats", "languages",
    "max_hours", "busy_dates", "description",
)


class CatalogError(ValueError):
    """The catalog cannot safely be used for recommendations."""


@dataclass(frozen=True)
class Catalog:
    profiles: tuple[dict[str, Any], ...]
    version: str

    def meta(self) -> dict[str, Any]:
        return {
            "api_version": 1,
            "dataset_version": self.version,
            "dataset_count": len(self.profiles),
            "cities": sorted({p["city"] for p in self.profiles}),
            "categories": sorted({v for p in self.profiles for v in p["categories"]}),
            "event_types": sorted({v for p in self.profiles for v in p["event_formats"]}),
            "languages": sorted({v for p in self.profiles for v in p["languages"]}),
            "date_range": {"min": DATE_MIN, "max": DATE_MAX},
        }


def _positive_integer(value: str, column: str) -> int:
    if not re.fullmatch(r"[0-9]+", value) or int(value) <= 0:
        raise CatalogError(f"Поле {column}: требуется положительное целое число.")
    return int(value)


def _boolean(value: str, column: str) -> bool:
    if value not in {"True", "False"}:
        raise CatalogError(f"Поле {column}: допустимы только True или False.")
    return value == "True"


def _list(value: str, column: str) -> tuple[str, ...]:
    items = tuple(part.strip() for part in value.split("|"))
    if not items or any(not item for item in items):
        raise CatalogError(f"Поле {column}: список не должен быть пустым.")
    return tuple(dict.fromkeys(items))


def load_catalog(path: Path) -> Catalog:
    """Validate every row; an invalid catalog fails rather than losing profiles.

    The digest covers the original file bytes, including their original encoding
    marker and newlines. The calendar's coverage is declared, not inferred from
    the first and last busy date. Empty max_hours means presence is inapplicable.
    """
    try:
        raw = Path(path).read_bytes()
        decoded = raw.decode("utf-8-sig")
    except (OSError, UnicodeError) as exc:
        raise CatalogError("Не удалось прочитать каталог в формате UTF-8.") from exc
    reader = csv.DictReader(io.StringIO(decoded, newline=""), strict=True)
    try:
        headers = reader.fieldnames
        if (
            not headers
            or len(headers) != len(set(headers))
            or set(headers) != set(REQUIRED_COLUMNS)
        ):
            raise CatalogError("Заголовок CSV не соответствует схеме каталога.")
        profiles: list[dict[str, Any]] = []
        seen: set[str] = set()
        for line, row in enumerate(reader, start=2):
            if None in row or any(value is None for value in row.values()):
                raise CatalogError(f"Строка {line}: неверное количество полей.")
            record = {key: value.strip() for key, value in row.items()}
            try:
                for column in ("id", "anon_name", "city", "description"):
                    if not record[column]:
                        raise CatalogError(f"Поле {column} не должно быть пустым.")
                if record["id"] in seen:
                    raise CatalogError("Повторяющийся id профиля.")
                busy_dates: set[str] = set()
                if record["busy_dates"]:
                    for value in _list(record["busy_dates"], "busy_dates"):
                        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                            raise CatalogError("busy_dates: требуется дата YYYY-MM-DD.")
                        parsed = date.fromisoformat(value)
                        if not DATE_MIN <= parsed.isoformat() <= DATE_MAX:
                            raise CatalogError("busy_dates: дата за пределами календаря.")
                        busy_dates.add(value)
                profile: dict[str, Any] = {
                    "id": record["id"],
                    "anon_name": record["anon_name"],
                    "categories": _list(record["categories"], "categories"),
                    "city": record["city"],
                    "price_from_kzt": _positive_integer(record["price_from_kzt"], "price_from_kzt"),
                    "event_formats": _list(record["event_formats"], "event_formats"),
                    "languages": _list(record["languages"], "languages"),
                    "max_hours": _positive_integer(record["max_hours"], "max_hours") if record["max_hours"] else None,
                    "busy_dates": frozenset(busy_dates),
                    "description": record["description"],
                    **{column: _boolean(record[column], column) for column in (
                        "synthetic", "city_imputed", "price_imputed"
                    )},
                }
                profiles.append(profile)
                seen.add(record["id"])
            except ValueError as exc:
                raise CatalogError(f"Строка {line}: {exc}") from exc
    except csv.Error as exc:
        raise CatalogError("CSV содержит некорректную структуру.") from exc
    if not profiles:
        raise CatalogError("В каталоге нет профилей.")
    return Catalog(tuple(profiles), hashlib.sha256(raw).hexdigest())
