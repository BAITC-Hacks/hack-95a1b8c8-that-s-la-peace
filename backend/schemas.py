"""The version-one HTTP contract, with strict input validation."""
from datetime import date
import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DATE_MIN = date(2026, 9, 23)
DATE_MAX = date(2026, 12, 31)


class RecommendationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    city: str = Field(min_length=1)
    event_date: str
    event_type: str = Field(min_length=1)
    category: str = Field(min_length=1)
    budget_kzt: int = Field(gt=0)
    duration_hours: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    language: str | None = Field(default=None, min_length=1)

    @field_validator("city", "event_date", "event_type", "category", "language", mode="before")
    @classmethod
    def strip_strings(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("duration_hours", mode="before")
    @classmethod
    def finite_duration(cls, value):
        if value is not None:
            if type(value) not in (int, float):
                raise ValueError("Укажите положительное число часов или null.")
            try:
                finite = math.isfinite(value)
            except OverflowError:
                finite = False
            if not finite:
                raise ValueError("Количество часов должно быть конечным числом.")
        return value

    @field_validator("event_date")
    @classmethod
    def calendar_date(cls, value: str) -> str:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise ValueError("Укажите дату в формате YYYY-MM-DD.")
        try:
            parsed = date.fromisoformat(value)
        except ValueError:
            raise ValueError("Такой даты не существует.") from None
        if not DATE_MIN <= parsed <= DATE_MAX:
            raise ValueError("Дата должна быть внутри календаря 23.09.2026–31.12.2026.")
        return value


class Card(BaseModel):
    id: str
    name: str
    category: str
    city: str
    price_from_kzt: int = Field(gt=0)
    explanation: str = Field(min_length=1)
    languages: list[str]
    max_hours: float | None
    description_excerpt: str = Field(min_length=1)
    synthetic: bool
    city_imputed: bool
    price_imputed: bool
    source: Literal["provided", "team_added"]


class Exclusions(BaseModel):
    busy: int = Field(ge=0)
    budget: int = Field(ge=0)
    event_type: int = Field(ge=0)
    language: int = Field(ge=0)
    duration: int = Field(ge=0)


class Suggestion(BaseModel):
    kind: Literal["change_date", "increase_budget"]
    message: str = Field(min_length=1)
    request: RecommendationRequest
    eligible_count: int = Field(gt=0)


class RecommendationResponse(BaseModel):
    api_version: Literal[1]
    dataset_version: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: Literal["matched", "no_category_in_city", "no_matches"]
    message: str = Field(min_length=1)
    cards: list[Card] = Field(max_length=3)
    total_in_city_category: int = Field(ge=0)
    eligible_count: int = Field(ge=0)
    exclusions: Exclusions
    suggestions: list[Suggestion] = Field(max_length=2)
    explanation_mode: Literal["deterministic", "llm", "deterministic_fallback"]
