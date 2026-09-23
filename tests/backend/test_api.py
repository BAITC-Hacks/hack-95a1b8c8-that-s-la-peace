"""HTTP contract, strict validation, readiness and static-file boundaries."""

import json

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from conftest import DATA_PATH


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert body["error"]["message"].strip()
    assert isinstance(body["error"]["fields"], dict)
    assert "Traceback" not in response.text
    return body["error"]


def test_health_meta_and_recommendation_share_catalogue(client, catalog, query):
    assert client.get("/api/health").json() == {"status": "ok", "api_version": 1, "dataset_count": 66}
    meta_response = client.get("/api/meta")
    assert meta_response.status_code == 200
    meta = meta_response.json()
    assert meta["dataset_count"] == 66
    assert meta["dataset_version"] == catalog.version
    assert meta["date_range"] == {"min": "2026-09-23", "max": "2026-12-31"}
    for field in ("cities", "categories", "event_types", "languages"):
        assert meta[field] == sorted(set(meta[field]))
    response = client.post("/api/recommendations", json=query)
    assert response.status_code == 200
    body = response.json()
    assert body["api_version"] == 1
    assert body["dataset_version"] == meta["dataset_version"]
    assert body["status"] == "matched"
    assert body["eligible_count"] == 6
    assert len(body["cards"]) == 3
    assert body["explanation_mode"] in {"deterministic", "llm", "deterministic_fallback"}


@pytest.mark.parametrize("field,value", [
    ("budget_kzt", True), ("budget_kzt", "1000000"), ("budget_kzt", 1000000.0),
    ("budget_kzt", 0), ("budget_kzt", -1), ("budget_kzt", None),
    ("duration_hours", 0), ("duration_hours", -1), ("duration_hours", True),
    ("duration_hours", "4"), ("duration_hours", ""),
    ("city", "Unknown"), ("city", "   "), ("city", 1),
    ("category", "Unknown"), ("event_type", "Unknown"),
    ("language", "Unknown"), ("language", ""),
    ("event_date", "2026-09-22"), ("event_date", "2027-01-01"),
    ("event_date", "2026-11-31"), ("event_date", "15.10.2026"),
    ("event_date", "2026-10-15T00:00:00"), ("event_date", 20261015),
    ("unexpected", 1),
])
def test_invalid_input_uses_one_error_schema(client, query, field, value):
    error = assert_error(client.post("/api/recommendations", json={**query, field: value}), 422, "invalid_request")
    assert error["fields"]


@pytest.mark.parametrize("field", ["city", "event_date", "event_type", "category", "budget_kzt"])
def test_missing_required_fields(client, query, field):
    query.pop(field)
    error = assert_error(client.post("/api/recommendations", json=query), 422, "invalid_request")
    assert field in error["fields"]


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_duration_is_rejected_without_server_error(client, query, value):
    raw = json.dumps({**query, "duration_hours": value}, allow_nan=True)
    response = client.post("/api/recommendations", content=raw, headers={"Content-Type": "application/json"})
    assert_error(response, 422, "invalid_request")


@pytest.mark.parametrize("raw", ["{", "null", "[]"])
def test_malformed_or_nonobject_json(client, raw):
    response = client.post("/api/recommendations", content=raw, headers={"Content-Type": "application/json"})
    assert_error(response, 422, "invalid_request")


@pytest.mark.parametrize("date", ["2026-09-23", "2026-12-31"])
def test_calendar_endpoints_are_inclusive(client, query, date):
    assert client.post("/api/recommendations", json={**query, "event_date": date}).status_code == 200


def test_normalization_optional_values_and_large_budget(client, query):
    baseline = client.post("/api/recommendations", json=query).json()
    normalized = {**query, "city": "  Алматы  ", "category": "  Ведущий "}
    normalized.pop("duration_hours")
    normalized.pop("language")
    assert client.post("/api/recommendations", json=normalized).json() == baseline
    assert client.post("/api/recommendations", json={**query, "budget_kzt": 10**20}).status_code == 200
    assert client.post("/api/recommendations", json={**query, "duration_hours": 1.5}).status_code == 200


@pytest.mark.parametrize("changes,status", [
    ({"city": "Зарубежье"}, "no_category_in_city"),
    ({"budget_kzt": 1}, "no_matches"),
])
def test_empty_results_are_successful_business_outcomes(client, query, changes, status):
    response = client.post("/api/recommendations", json={**query, **changes})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == status
    assert body["cards"] == []
    assert body["eligible_count"] == 0
    assert body["message"].strip()


@pytest.mark.parametrize("missing", [True, False])
def test_unavailable_catalogue_reports_503_instead_of_empty_matches(tmp_path, query, missing):
    source = tmp_path / "broken.csv"
    if not missing:
        source.write_text("unexpected,headers\ninvalid,data\n", encoding="utf-8")
    with TestClient(create_app(data_path=source, frontend_dir=tmp_path / "no-ui")) as client:
        for url in ("/api/health", "/api/meta"):
            error = assert_error(client.get(url), 503, "service_unavailable")
            assert error["fields"] == {}
            assert str(tmp_path) not in error["message"]
        assert_error(client.post("/api/recommendations", json=query), 503, "service_unavailable")


def test_missing_frontend_is_not_claimed_ready(client):
    assert_error(client.get("/"), 503, "service_unavailable")


def test_static_server_exposes_only_frontend_and_preserves_api(tmp_path):
    ui = tmp_path / "frontend"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html><title>Owned frontend</title>", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("DO-NOT-SERVE", encoding="utf-8")
    with TestClient(create_app(data_path=DATA_PATH, frontend_dir=ui)) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert "Owned frontend" in response.text
        assert client.get("/api/health").status_code == 200
        for path in ("/data/contractors.csv", "/README.md", "/.git/config", "/%2e%2e/secret.txt"):
            blocked = client.get(path)
            assert blocked.status_code in {403, 404}
            assert "DO-NOT-SERVE" not in blocked.text


def test_unexpected_matcher_error_is_safe_unified_503(tmp_path, query, monkeypatch):
    def failing_matcher(*args, **kwargs):
        raise RuntimeError("SECRET_RUNTIME_PATH_AND_INTERNAL_DETAILS")

    monkeypatch.setattr("backend.app.recommend", failing_matcher)
    with TestClient(
        create_app(data_path=DATA_PATH, frontend_dir=tmp_path / "no-ui"),
        raise_server_exceptions=False,
    ) as client:
        response = client.post("/api/recommendations", json=query)
        error = assert_error(response, 503, "service_unavailable")
        assert error["fields"] == {}
        assert "SECRET_RUNTIME_PATH_AND_INTERNAL_DETAILS" not in response.text
        assert "RuntimeError" not in response.text
        assert client.get("/api/health").status_code == 200


@pytest.fixture
def frontend_with_private_files(tmp_path):
    ui = tmp_path / "frontend"
    ui.mkdir()
    public = {
        "index.html": "<!doctype html><title>Public UI</title>",
        "styles.css": "body { color: black; }",
        "app.mjs": "import './view.mjs';",
        "view.mjs": "export const view = true;",
        "api.mjs": "export const api = true;",
    }
    for name, text in public.items():
        (ui / name).write_text(text, encoding="utf-8")
    for name in ("AGENTS.md", "README.md", "serve.mjs", ".env.example", ".env",
                 ".gitignore", "private.json", "dev.html", "unlisted.mjs"):
        (ui / name).write_text("FAKE_PRIVATE_TEST_VALUE", encoding="utf-8")
    (ui / ".git").mkdir()
    (ui / ".git" / "config").write_text("FAKE_PRIVATE_TEST_VALUE", encoding="utf-8")
    (tmp_path / "private.txt").write_text("FAKE_PRIVATE_TEST_VALUE", encoding="utf-8")
    return ui, public


@pytest.mark.parametrize("route,filename,mime", [
    ("/", "index.html", "text/html"),
    ("/index.html", "index.html", "text/html"),
    ("/styles.css", "styles.css", "text/css"),
    ("/app.mjs", "app.mjs", "text/javascript"),
    ("/view.mjs", "view.mjs", "text/javascript"),
    ("/api.mjs", "api.mjs", "text/javascript"),
])
def test_public_frontend_assets_preserve_get_head_and_mime(frontend_with_private_files, route, filename, mime):
    ui, public = frontend_with_private_files
    with TestClient(create_app(data_path=DATA_PATH, frontend_dir=ui)) as client:
        response = client.get(route)
        assert response.status_code == 200
        assert response.text == public[filename]
        assert response.headers["content-type"].split(";")[0] == mime
        head = client.head(route)
        assert head.status_code == 200
        assert head.content == b""
        assert head.headers["content-type"] == response.headers["content-type"]
        assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize("route", [
    "/AGENTS.md", "/README.md", "/serve.mjs", "/.env.example", "/.env",
    "/.gitignore", "/.git/config", "/private.json", "/dev.html",
    "/unlisted.mjs", "/%2eenv", "/%2e%2e/private.txt",
])
def test_static_server_blocks_existing_private_frontend_files(frontend_with_private_files, route):
    ui, _ = frontend_with_private_files
    with TestClient(create_app(data_path=DATA_PATH, frontend_dir=ui)) as client:
        for method in (client.get, client.head):
            response = method(route)
            assert response.status_code == 404
            assert "FAKE_PRIVATE_TEST_VALUE" not in response.text


def test_missing_catalog_and_frontend_do_not_claim_api_ready(tmp_path):
    with TestClient(create_app(data_path=tmp_path / "missing.csv", frontend_dir=tmp_path / "missing-ui")) as client:
        error = assert_error(client.get("/"), 503, "service_unavailable")
        assert "API доступен" not in error["message"]
        assert "Каталог недоступен" in error["message"]
        assert str(tmp_path) not in error["message"]
        assert_error(client.get("/api/health"), 503, "service_unavailable")


@pytest.mark.parametrize("failure,expected_reason", [
    ("missing", "отсутствует"),
    ("encoding", "UTF-8"),
    ("header", "Заголовок CSV"),
    ("field", "Строка 2: Поле price_from_kzt"),
])
def test_catalog_failure_logs_actionable_reason_without_http_details(tmp_path, write_catalog, caplog, failure, expected_reason):
    source = tmp_path / "catalog.csv"
    if failure == "encoding":
        source.write_bytes(b"\xff\xfeINVALID_TEST_ENCODING")
    elif failure == "header":
        source.write_text("wrong,header\ninvalid,data\n", encoding="utf-8")
    elif failure == "field":
        source = write_catalog([{"price_from_kzt": "-1"}])
    with caplog.at_level("ERROR", logger="backend.app"):
        with TestClient(create_app(data_path=source, frontend_dir=tmp_path / "missing-ui")) as client:
            response = client.get("/api/health")
            error = assert_error(response, 503, "service_unavailable")
            assert str(source) not in response.text
            assert str(tmp_path) not in response.text
            assert error["fields"] == {}
            assert expected_reason not in error["message"]
    assert expected_reason in caplog.text


def test_public_api_uses_project_name(client):
    schema = client.get("/openapi.json")
    assert schema.status_code == 200
    assert schema.json()["info"]["title"] == "Умный подбор подрядчиков"
    assert schema.json()["info"]["version"] == "1.0.0"
