"""Deterministic, grounded matching and one-condition alternatives.

All hard constraints run first. Eligible profiles sort by distinct event-related
word stems in description (descending), then requested-category word stems
(descending), then initial price (ascending), then stable id (ascending).
Each distinct stem counts once, so repeating marketing text gives no advantage.
This transparent lexical relevance is not a learned model or a quality rating.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any

from .catalog import Catalog, DATE_MAX, DATE_MIN

EVENT_STEMS = {
    "свадьба": ("свад", "бракосочет", "wedding"),
    "корпоратив": ("корпоратив", "бизнес", "business", "corporate"),
    "конференция": ("конференц", "форум", "conference"),
    "день рождения": ("рождени", "birthday"),
    "юбилей": ("юбиле", "anniversary"),
    "той": ("той", "торжеств"),
}
CATEGORY_STEMS = {
    "Ведущий": ("ведущ", "веден", "веду", "сценар", "импровиз"),
    "Ведущий церемонии": ("церемони", "регистрац", "бракосочет"),
    "Фотограф": ("фотограф", "фотожурнал", "съемк", "кадр"),
    "Видеограф": ("видеограф", "видео", "фильм", "съемк"),
    "Флорист": ("флорист", "цвет", "композиц"),
    "Декоратор": ("декор", "сценограф", "оформлен", "инсталляц"),
    "Инструменталист": ("инструмент", "скрип", "саксофон", "репертуар"),
    "Лайв-бэнд": ("музык", "групп", "репертуар", "джаз"),
    "Национальный ансамбль": ("ансамбл", "казах", "песн"),
    "Подарки и сувениры": ("подар", "сувенир", "мерч", "дизайн"),
    "Фото и видеобудки": ("фотобуд", "фото", "печать", "зеркал"),
    "Банкетный зал": ("банкет", "зал", "вместим"),
    "Ресторан": ("ресторан", "кухн", "кейтеринг"),
    "Отель": ("отель", "hotel", "гостиниц"),
    "Загородная площадка": ("загород", "гольф", "площадк", "панорам"),
    "Танцевальный коллектив": ("танц", "коллектив", "выступ"),
    "Шоу-программа": ("шоу", "сцен", "выступ", "перформанс"),
}
REASONS = ("busy", "budget", "event_type", "language", "duration")
REASON_LABELS = {
    "busy": "занятость на дату",
    "budget": "начальная цена выше бюджета",
    "event_type": "формат не указан в профиле",
    "language": "нужный язык не указан",
    "duration": "превышен лимит часов",
}


def _words(text: str) -> tuple[str, ...]:
    return tuple(re.findall(r"[a-zа-я0-9]+", text.casefold().replace("ё", "е")))


def _overlap(text: str, stems: tuple[str, ...]) -> int:
    words = _words(text)
    return sum(any(word.startswith(stem) for word in words) for stem in stems)


def _rank(profile: dict[str, Any], request: dict[str, Any]) -> tuple[Any, ...]:
    description = profile["description"]
    return (
        -_overlap(description, EVENT_STEMS.get(request["event_type"], _words(request["event_type"]))),
        -_overlap(description, CATEGORY_STEMS.get(request["category"], _words(request["category"]))),
        profile["price_from_kzt"],
        profile["id"],
    )


def _failures(profile: dict[str, Any], request: dict[str, Any]) -> dict[str, bool]:
    duration = request.get("duration_hours")
    language = request.get("language")
    return {
        "busy": request["event_date"] in profile["busy_dates"],
        "budget": profile["price_from_kzt"] > request["budget_kzt"],
        "event_type": request["event_type"] not in profile["event_formats"],
        "language": language is not None and language not in profile["languages"],
        "duration": duration is not None and profile["max_hours"] is not None and duration > profile["max_hours"],
    }


def _eligible(profiles: list[dict[str, Any]], request: dict[str, Any]) -> list[dict[str, Any]]:
    return [profile for profile in profiles if not any(_failures(profile, request).values())]


def _excerpt(profile: dict[str, Any], request: dict[str, Any]) -> str:
    """Return an exact substring, favouring a relevant descriptive clause."""
    description = profile["description"]
    candidates = [part.strip() for part in re.split(r"(?<=[.!?])\s+|[\r\n•]+", description) if part.strip()]
    useful = [part for part in candidates if len(part) >= 30] or candidates
    stems = EVENT_STEMS.get(request["event_type"], _words(request["event_type"]))
    category = CATEGORY_STEMS.get(request["category"], _words(request["category"]))
    specific_stems = (
        "разработ", "соглас", "интерактив", "оборудован", "мультимедийн", "dj",
        "сценар", "печать", "кейтеринг", "парков", "скрип", "саксофон",
        "театр", "кино", "педагог", "академ", "солист", "телеканал",
        "репертуар", "сезон", "палитр", "документал", "фотожурнал",
        "сценограф", "инсталляц", "подиум", "арки", "welcome", "сахар",
    )

    def excerpt_score(part: str) -> tuple[int, ...]:
        lowered = part.casefold().replace("ё", "е")
        introduction = bool(re.match(
            r"(?:меня зовут|привет|я[ ,—–-]|профессиональн\w*\s+ведущ)", lowered
        ))
        quantified = bool(re.search(
            r"\d[\d ]*\s+(?:лет|год|гостей|человек|заказов|мероприятий|свадеб|съемок)", lowered
        ))
        # Event relevance first; prefer concrete actions and specialties over
        # introductions and generic role labels. This only affects the excerpt.
        return (
            _overlap(part, stems),
            -int(introduction),
            _overlap(part, specific_stems) + 2 * int(quantified),
            _overlap(part, category),
        )

    # max() preserves the first source clause when relevance is tied.
    selected = max(useful, key=excerpt_score)
    if len(selected) > 260:
        boundary = selected.rfind(" ", 0, 261)
        selected = selected[:boundary if boundary > 100 else 260]
    return selected.rstrip(" .!?…") or description[:260]


def _money(amount: int) -> str:
    return f"{amount:,}".replace(",", " ")


def _card(profile: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    excerpt = _excerpt(profile, request)
    details = [
        f"В каталоге указан город {profile['city']} и формат «{request['event_type']}»",
        f"на {request['event_date']} занятость не указана",
        f"цена от {_money(profile['price_from_kzt'])} ₸ не превышает бюджет {_money(request['budget_kzt'])} ₸",
    ]
    if request.get("language") is not None:
        details.append(f"указан язык {request['language']}")
    if request.get("duration_hours") is not None:
        if profile["max_hours"] is None:
            details.append("лимит присутствия по часам неприменим")
        else:
            details.append(f"запрошенные {request['duration_hours']:g} ч укладываются в лимит {profile['max_hours']} ч")
    explanation = "; ".join(details) + f". В описании профиля: «{excerpt}»."
    return {
        "id": profile["id"],
        "name": profile["anon_name"],
        "category": request["category"],
        "city": profile["city"],
        "price_from_kzt": profile["price_from_kzt"],
        "explanation": explanation,
        "languages": list(profile["languages"]),
        "max_hours": profile["max_hours"],
        "description_excerpt": excerpt,
        "synthetic": profile["synthetic"],
        "city_imputed": profile["city_imputed"],
        "price_imputed": profile["price_imputed"],
        "source": "provided",
    }


def _suggestions(profiles: list[dict[str, Any]], request: dict[str, Any]) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    original_date = date.fromisoformat(request["event_date"])
    earliest, latest = date.fromisoformat(DATE_MIN), date.fromisoformat(DATE_MAX)
    candidates = [earliest + timedelta(days=offset) for offset in range((latest - earliest).days + 1)]
    candidates.sort(key=lambda candidate: (abs((candidate - original_date).days), candidate))
    # Only candidates that pass every non-date constraint can benefit from a date change.
    can_change_date = [p for p in profiles if not any(value for reason, value in _failures(p, request).items() if reason != "busy")]
    if can_change_date:
        for candidate in candidates:
            if candidate == original_date:
                continue
            changed = {**request, "event_date": candidate.isoformat()}
            count = len(_eligible(profiles, changed))
            if count:
                suggestions.append({
                    "kind": "change_date",
                    "message": f"На {candidate.isoformat()} подходящих профилей: {count}; изменится только дата.",
                    "request": changed,
                    "eligible_count": count,
                })
                break
    can_change_budget = [p for p in profiles if not any(value for reason, value in _failures(p, request).items() if reason != "budget")]
    if can_change_budget:
        budget = min(p["price_from_kzt"] for p in can_change_budget)
        if budget > request["budget_kzt"]:
            changed = {**request, "budget_kzt": budget}
            count = len(_eligible(profiles, changed))
            if count:
                suggestions.append({
                    "kind": "increase_budget",
                    "message": f"При бюджете {_money(budget)} ₸ подходящих профилей: {count}; сравнение по цене «от», итоговая стоимость требует уточнения.",
                    "request": changed,
                    "eligible_count": count,
                })
    return suggestions


def recommend(catalog: Catalog, request: dict[str, Any]) -> dict[str, Any]:
    """Match an already validated request; never mutate it or the catalog."""
    request = {"duration_hours": None, "language": None, **request}
    profiles = [p for p in catalog.profiles if p["city"] == request["city"] and request["category"] in p["categories"]]
    exclusions = {reason: 0 for reason in REASONS}
    eligible: list[dict[str, Any]] = []
    for profile in profiles:
        failures = _failures(profile, request)
        for reason, failed in failures.items():
            exclusions[reason] += int(failed)
        if not any(failures.values()):
            eligible.append(profile)
    eligible.sort(key=lambda profile: _rank(profile, request))
    total, count = len(profiles), len(eligible)
    reasons = "; ".join(f"{REASON_LABELS[reason]}: {number}" for reason, number in exclusions.items() if number)
    if not total:
        status = "no_category_in_city"
        message = f"В городе {request['city']} в каталоге нет профилей категории «{request['category']}»."
    elif not count:
        status = "no_matches"
        message = f"Всего профилей категории «{request['category']}» в городе {request['city']}: {total}. Ни один не проходит все условия. Причины: {reasons}. Причины могут пересекаться."
    else:
        status = "matched"
        message = f"Подходящих профилей: {count}; показано: {min(3, count)}."
        if count < 3:
            if total == count:
                message += f" Всего профилей в каталоге для этого города и категории: {total}."
            else:
                message += f" В исходной группе {total} профилей; ограничения: {reasons}. Причины могут пересекаться."
    return {
        "api_version": 1,
        "dataset_version": catalog.version,
        "status": status,
        "message": message,
        "cards": [_card(profile, request) for profile in eligible[:3]],
        "total_in_city_category": total,
        "eligible_count": count,
        "exclusions": exclusions,
        "suggestions": _suggestions(profiles, request) if status == "no_matches" else [],
        "explanation_mode": "deterministic",
    }
