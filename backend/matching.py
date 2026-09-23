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


_EXCERPT_LIMIT = 260
_SPECIFIC_STEMS = (
    "разработ", "соглас", "интерактив", "оборудован", "мультимедийн", "dj",
    "сценар", "печать", "кейтеринг", "парков", "скрип", "саксофон",
    "театр", "кино", "педагог", "академ", "солист", "телеканал",
    "репертуар", "сезон", "палитр", "документал", "фотожурнал",
    "сценограф", "инсталляц", "подиум", "арки", "welcome", "сахар",
    "вокал", "квартет", "брасс", "перкусс", "клавиш", "барабан",
    "гитар", "труба", "тромбон", "струнн", "викторин", "квиз", "акустич",
)
_BLOCK_HEADER = re.compile(
    r"(?<!\w)(?:(?:расширенный|большой|малый|базовый|полный|основной|"
    r"музыкальный|камерный)\s+){0,2}"
    r"(?:состав(?:\s+[^:.\n]{1,70})?|репертуар|оборудование|"
    r"пакет(?:\s+[^:.\n]{1,40})?|языки(?:\s+[^:.\n]{1,30})?)\s*:",
    re.IGNORECASE,
)


def _description_evidence(text: str) -> tuple[int, bool]:
    """A conservative factual signal, not a claim that source prose is verified."""
    lowered = text.casefold().replace("ё", "е")
    quantified = bool(re.search(
        r"\d[\d ]*\s+(?:лет|год|гостей|человек|заказов|мероприятий|свадеб|съемок|вокалист)",
        lowered,
    ))
    promotional = bool(re.search(
        r"идеальн\w*|отличн\w*\s+выбор|любой\s+формат|"
        r"незабываем\w*|сверкаем|безумн\w*\s+энергетик\w*", lowered,
    ))
    specificity = _overlap(text, _SPECIFIC_STEMS) + 2 * int(quantified)
    usable = specificity > 0 and (not promotional or quantified)
    return specificity, usable


def _source_blocks(description: str) -> list[str]:
    """Split exact source spans at sentences, bullets and named package headers."""
    blocks: list[str] = []
    for clause in re.split(r"(?<=[.!?])\s+|[\r\n•]+", description):
        starts = sorted({0, *(match.start() for match in _BLOCK_HEADER.finditer(clause))})
        for index, start in enumerate(starts):
            end = starts[index + 1] if index + 1 < len(starts) else len(clause)
            block = clause[start:end].strip()
            if block:
                blocks.append(block)
    return blocks


def _select_excerpt(profile: dict[str, Any], request: dict[str, Any]) -> tuple[str, bool]:
    """Return source text and whether it has a complete semantic boundary.

    Complete blocks take precedence over shortened previews. An oversized list
    can end after a complete item; its heading stays attached. No sliding word
    windows are used, so a later package cannot be attached to the previous one.
    Source order breaks score ties. Candidate ranking is unaffected.
    """
    description = profile["description"]
    candidates: list[tuple[str, bool]] = []
    for block in _source_blocks(description):
        if len(block) <= _EXCERPT_LIMIT:
            candidates.append((block, True))
            continue
        # End at an explicit phrase/list boundary, never an arbitrary word.
        # Emoji delimit instrument items in the provided dataset.
        boundaries = [match.start() for match in re.finditer(
            r"[,;](?=\s)|(?=[\U0001F300-\U0001FAFF\u2600-\u27BF])", block
        )]
        boundaries += [match.end() for match in re.finditer(r"[»)](?=\s)", block)]
        for end in sorted(set(boundaries)):
            candidate = block[:end].rstrip(" ,;")
            if 30 <= len(candidate) <= _EXCERPT_LIMIT:
                # The remaining text may qualify or negate this fragment.
                # A shortened preview is never a complete evidence statement.
                candidates.append((candidate, False))
    if not candidates:
        # An unsegmented malformed/very long source can only supply a preview.
        # _card will use structured facts instead of treating that preview as
        # a recommendation reason. Keep the text an exact source substring.
        preview = description[:_EXCERPT_LIMIT]
        boundary = preview.rfind(" ")
        return (preview[:boundary] if boundary > 0 else preview), False
    stems = EVENT_STEMS.get(request["event_type"], _words(request["event_type"]))
    category = CATEGORY_STEMS.get(request["category"], _words(request["category"]))

    def excerpt_score(candidate: tuple[str, bool]) -> tuple[int, ...]:
        part, complete = candidate
        specificity, usable = _description_evidence(part)
        introduction = bool(re.match(
            r"(?:меня зовут|привет|я[ ,—–-]|профессиональн\w*\s+ведущ)",
            part.casefold(),
        ))
        return (
            int(complete and usable), int(complete), _overlap(part, stems), specificity,
            -int(introduction), _overlap(part, category),
        )

    useful = [candidate for candidate in candidates if len(candidate[0]) >= 30] or candidates
    selected, complete = max(useful, key=excerpt_score)
    return selected.rstrip(" .!?…"), complete


def _excerpt(profile: dict[str, Any], request: dict[str, Any]) -> str:
    """Keep the text-only private helper available for catalog inspection."""
    return _select_excerpt(profile, request)[0]


def _money(amount: int) -> str:
    return f"{amount:,}".replace(",", " ")


def _card(profile: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
    excerpt, complete = _select_excerpt(profile, request)
    details = [
        f"{profile['city']}, «{request['event_type']}»: цена от {_money(profile['price_from_kzt'])} ₸ в бюджете",
        f"в календаре на {request['event_date']} нет занятости",
    ]
    if request.get("language") is not None:
        details.append(f"язык — {request['language']}")
    if request.get("duration_hours") is not None:
        if profile["max_hours"] is None:
            details.append("присутствие по часам неприменимо")
        else:
            details.append(f"{request['duration_hours']:g} ч при лимите {profile['max_hours']} ч")
    if complete and _description_evidence(excerpt)[1]:
        evidence = f"Из описания: «{excerpt}»"
    else:
        # These are catalog capabilities, not preferences the user requested.
        languages = ", ".join(profile["languages"])
        presence = (
            f"на площадке до {profile['max_hours']} ч"
            if profile["max_hours"] is not None
            else "работа не привязана к присутствию по часам"
        )
        evidence = f"В профиле: языки — {languages}; {presence}"
    explanation = "; ".join(details) + f". {evidence}."
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
