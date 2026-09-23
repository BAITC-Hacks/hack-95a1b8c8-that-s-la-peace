"""Source-grounded regression cases; these are technical checks, not human approval."""

import re

import pytest

from backend.matching import recommend


# Each target must appear in a genuine top-three result from the provided CSV.
REVIEW_CASES = (
    ("photo-approach", "Фотограф", "свадьба", "2026-10-15", 1_000_000, None, "HK-91112"),
    ("photo-structured", "Фотограф", "свадьба", "2026-10-15", 1_000_000, None, "HK-76268"),
    ("video-attributed-source", "Видеограф", "свадьба", "2026-10-17", 1_500_000, None, "HK-62242"),
    ("video-structured", "Видеограф", "свадьба", "2026-10-17", 1_500_000, None, "HK-45928"),
    ("band-expanded", "Лайв-бэнд", "корпоратив", "2026-10-16", 1_150_000, None, "HK-23752"),
    ("band-large", "Лайв-бэнд", "корпоратив", "2026-10-16", 1_150_000, None, "HK-31819"),
    ("venue-specific", "Банкетный зал", "корпоратив", "2026-11-14", 6_000_000, None, "HK-90011"),
    ("venue-structured", "Банкетный зал", "корпоратив", "2026-11-14", 6_000_000, None, "HK-64395"),
    ("florist-palette", "Флорист", "свадьба", "2026-10-15", 1_000_000, 24, "HK-90001"),
    ("florist-quantified", "Флорист", "свадьба", "2026-10-15", 1_000_000, 24, "HK-39372"),
)

SOURCE_FACTS = {
    "HK-91112": ("Мои кадры — не про позы, а про состояние",),
    "HK-76268": ("Снимаю в Алмате и Астане", "Вхожу в топ 5 Алматы по версии AniWed Rating"),
    "HK-62242": ("топ-3 видеографов страны по версии AniWed KZ", "«Лучший репортажный видеограф»"),
    "HK-45928": ("свадебной, семейной и рекламной съёмке", "Формат съёмки: full day"),
    "HK-23752": ("Расширенный состав", "два вокалиста", "вокалистка", "ретро-хиты", "казахскую музыку"),
    "HK-31819": ("Большой состав", "4 профессиональных вокалиста", "струнный квартет (4 музыканта)", "звукорежиссёр"),
    "HK-90011": ("вместимость зала до 200 гостей", "свой кейтеринг и парковка"),
    "HK-64395": ("панорамная локация",),
    "HK-90001": ("сезонными и привозными цветами", "под цветовую палитру мероприятия"),
    "HK-39372": ("Ежемесячно реализуем более 1000 заказов",),
}


def review_request(case):
    _, category, event_type, event_date, budget, duration, _ = case
    return {
        "city": "Алматы", "event_date": event_date, "event_type": event_type,
        "category": category, "budget_kzt": budget,
        "duration_hours": duration, "language": None,
    }


@pytest.mark.parametrize("case", REVIEW_CASES, ids=[case[0] for case in REVIEW_CASES])
def test_reviewed_real_profiles_keep_source_and_request_constraints(catalog, case):
    request = review_request(case)
    response = recommend(catalog, request)
    profile_id = case[-1]
    card = next(card for card in response["cards"] if card["id"] == profile_id)
    source = next(profile for profile in catalog.profiles if profile["id"] == profile_id)

    assert response["status"] == "matched"
    assert response["explanation_mode"] == "deterministic"
    assert response["dataset_version"] == catalog.version
    assert source["city"] == request["city"] == card["city"]
    assert request["category"] in source["categories"]
    assert request["event_type"] in source["event_formats"]
    assert request["event_date"] not in source["busy_dates"]
    assert card["price_from_kzt"] == source["price_from_kzt"] <= request["budget_kzt"]
    assert card["languages"] == list(source["languages"])
    assert card["max_hours"] == source["max_hours"]
    for field in ("synthetic", "city_imputed", "price_imputed"):
        assert card[field] == source[field]
    assert card["source"] == "provided"
    assert all(fact in source["description"] for fact in SOURCE_FACTS[profile_id])

    excerpt = card["description_excerpt"]
    explanation = card["explanation"]
    assert excerpt and len(excerpt) <= 260
    assert excerpt in source["description"]
    assert 1 <= len(re.findall(r"[.!?](?=\s|$|»)", explanation)) <= 2
    assert source["anon_name"] not in explanation
    assert "₸ в бюджете" in explanation
    assert f"в календаре на {request['event_date']} нет занятости" in explanation
    assert not any(claim in explanation.casefold() for claim in (
        "гарантированное качество", "лучший выбор для вас", "забронирован", "рейтинг 5",
    ))

    if "Из описания: «" in explanation:
        # The complete quote remains attributable to the source; no new rating
        # or claim is inserted into it by the recommendation engine.
        assert explanation.endswith(f"Из описания: «{excerpt}».")
    elif "По описанию," in explanation:
        assert profile_id in {"HK-23752", "HK-31819"}
        assert "её нужно уточнить" in explanation
        assert not re.search(r"₸|\bтенге\b|\bстоимость\b|\bцена\b", source["description"].casefold())
        assert "включено в цену" not in explanation
    else:
        # A limited source does not justify an invented specialty or a rating.
        languages = ", ".join(source["languages"])
        assert explanation.endswith(
            f"В профиле: языки — {languages}; на площадке до {source['max_hours']} ч."
        )

    if profile_id == "HK-91112":
        assert "не про позы, а про состояние" in explanation
        assert "без постановки" not in explanation
        assert "без позирования" not in explanation
    elif profile_id == "HK-62242":
        assert "Из описания: «" in explanation
        assert "по версии AniWed KZ" in explanation
        assert "«Лучший репортажный видеограф»" in explanation
    elif profile_id == "HK-45928":
        assert "на площадке до 10 ч" in explanation
        assert "24" not in explanation
        assert "стабильное качество" not in explanation
        assert "других конкретных характеристик" not in explanation
    elif profile_id == "HK-23752":
        assert "расширенный состав: два вокалиста и вокалистка" in explanation
        assert "репертуар — ретро-хиты, современные композиции и казахская музыка" in explanation
        assert "стоимость расширенного состава" in explanation
    elif profile_id == "HK-31819":
        assert "большой состав: 4 вокалиста, струнный квартет" in explanation
        assert "звукорежиссёр" in explanation
        assert "стоимость большого состава" in explanation
    elif profile_id == "HK-90011":
        assert "до 200 гостей" in explanation
    if request["category"] == "Флорист":
        assert source["max_hours"] is None
        assert "Для флориста ограничение по длительности присутствия не применяется" in explanation
        assert "24 ч" not in explanation


def test_review_set_covers_two_distinct_profiles_in_each_required_category():
    categories = {case[1] for case in REVIEW_CASES}
    assert categories == {"Фотограф", "Видеограф", "Лайв-бэнд", "Банкетный зал", "Флорист"}
    assert len({case[-1] for case in REVIEW_CASES}) == 10
    assert all(sum(case[1] == category for case in REVIEW_CASES) == 2 for category in categories)
