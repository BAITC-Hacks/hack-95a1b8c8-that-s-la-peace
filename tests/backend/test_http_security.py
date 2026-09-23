"""Request byte boundaries, common headers and frontend-only CSP."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.security import FRONTEND_CSP, MAX_REQUEST_BODY_BYTES
from conftest import DATA_PATH


def check_headers(headers):
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["referrer-policy"] == "no-referrer"


def check_too_large(response):
    assert response.status_code == 413
    assert response.json() == {"error": {
        "code": "request_too_large", "message": "Размер тела запроса превышает 16 КиБ.", "fields": {},
    }}
    check_headers(response.headers)
    assert "Traceback" not in response.text and "AppData" not in response.text


def padded_request(query, size):
    encoded = json.dumps(query, ensure_ascii=False).encode("utf-8")
    assert len(encoded) <= size
    return encoded + b" " * (size - len(encoded))


def test_normal_and_exact_16kib_body_keep_success_contract(client, query):
    normal = client.post("/api/recommendations", json=query)
    boundary = client.post("/api/recommendations", content=padded_request(query, MAX_REQUEST_BODY_BYTES), headers={"content-type": "application/json"})
    assert normal.status_code == boundary.status_code == 200
    assert boundary.json() == normal.json()
    check_headers(boundary.headers)


@pytest.mark.parametrize("declared", [None, "1", str(MAX_REQUEST_BODY_BYTES + 1)])
def test_actual_oversized_body_is_rejected_and_server_remains_usable(client, query, declared):
    headers = {"content-type": "application/json"}
    if declared is not None:
        headers["content-length"] = declared
    response = client.post("/api/recommendations", content=padded_request(query, MAX_REQUEST_BODY_BYTES + 1), headers=headers)
    check_too_large(response)
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.post("/api/recommendations", json=query).status_code == 200


async def raw_request(app, chunks, headers=()):
    """Expose individual ASGI chunks; HTTP clients may coalesce iterators."""
    messages = [
        {"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1}
        for i, chunk in enumerate(chunks)
    ]
    sent = []
    reads = 0

    async def receive():
        nonlocal reads
        reads += 1
        return messages.pop(0) if messages else {"type": "http.disconnect"}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "POST", "scheme": "http", "path": "/api/recommendations",
        "raw_path": b"/api/recommendations", "query_string": b"", "root_path": "",
        "headers": [(b"content-type", b"application/json"), *headers],
        "server": ("testserver", 80), "client": ("testclient", 1),
    }
    await app(scope, receive, send)
    start = next(message for message in sent if message["type"] == "http.response.start")
    body = b"".join(message.get("body", b"") for message in sent if message["type"] == "http.response.body")
    return start, json.loads(body), reads


@pytest.mark.parametrize("headers", [
    [(b"transfer-encoding", b"chunked")],
    [(b"content-length", b"1")],
])
def test_individual_chunks_are_counted_without_reliable_content_length(tmp_path, query, headers):
    app = create_app(data_path=DATA_PATH, frontend_dir=tmp_path / "absent")
    payload = padded_request(query, MAX_REQUEST_BODY_BYTES + 1)
    with TestClient(app) as client:
        start, body, reads = asyncio.run(raw_request(app, [payload[:8000], payload[8000:16000], payload[16000:]], headers))
        assert start["status"] == 413
        assert body["error"]["code"] == "request_too_large"
        assert body["error"]["fields"] == {}
        assert reads == 3
        check_headers({k.decode(): v.decode() for k, v in start["headers"]})
        assert client.get("/api/health").status_code == 200
        assert client.post("/api/recommendations", json=query).status_code == 200


def test_oversized_declaration_is_rejected_before_reading_body(tmp_path):
    app = create_app(data_path=DATA_PATH, frontend_dir=tmp_path / "absent")
    start, body, reads = asyncio.run(raw_request(app, [], [(b"content-length", b"99999999")]))
    assert start["status"] == 413
    assert body["error"]["code"] == "request_too_large"
    assert reads == 0


def test_utf8_limit_counts_bytes_not_characters(client, query):
    body = " " * 16381 + '"я"'
    assert len(body) <= MAX_REQUEST_BODY_BYTES < len(body.encode("utf-8"))
    check_too_large(client.post("/api/recommendations", content=body.encode("utf-8"), headers={"content-type": "application/json"}))


@pytest.mark.parametrize("path,status", [
    ("/api/meta", 200), ("/api/health", 200), ("/missing", 404),
    ("/docs", 200), ("/redoc", 200), ("/openapi.json", 200),
])
def test_baseline_headers_on_api_errors_and_docs_without_frontend_csp(client, path, status):
    response = client.get(path)
    assert response.status_code == status
    check_headers(response.headers)
    assert "content-security-policy" not in response.headers


def test_validation_and_readiness_errors_have_baseline_headers(client, tmp_path):
    invalid = client.post("/api/recommendations", json={})
    assert invalid.status_code == 422
    check_headers(invalid.headers)
    with TestClient(create_app(data_path=tmp_path / "missing.csv", frontend_dir=tmp_path / "none")) as unavailable:
        failed = unavailable.get("/api/health")
        assert failed.status_code == 503
        check_headers(failed.headers)
        assert str(tmp_path) not in failed.text


def test_unexpected_server_error_has_headers_and_no_internal_details(tmp_path, query, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("PRIVATE_PATH_TEST_VALUE")
    monkeypatch.setattr("backend.app.recommend", broken)
    with TestClient(create_app(data_path=DATA_PATH, frontend_dir=tmp_path / "none"), raise_server_exceptions=False) as client:
        response = client.post("/api/recommendations", json=query)
        assert response.status_code == 503
        check_headers(response.headers)
        assert "PRIVATE_PATH_TEST_VALUE" not in response.text
        assert client.get("/api/health").status_code == 200


def test_csp_applies_only_to_allowlisted_frontend_and_preserves_docs(tmp_path):
    ui = tmp_path / "frontend"
    ui.mkdir()
    for name, content in {
        "index.html": '<!doctype html><script type="module" src="./app.mjs"></script>',
        "app.mjs": "export const ready = true;",
        "styles.css": "body { color: black; }",
        "private.json": "FAKE_PRIVATE_VALUE",
    }.items():
        (ui / name).write_text(content, encoding="utf-8")
    with TestClient(create_app(data_path=DATA_PATH, frontend_dir=ui)) as client:
        for path in ("/", "/index.html", "/app.mjs", "/styles.css"):
            for method in (client.get, client.head):
                response = method(path)
                assert response.status_code == 200
                check_headers(response.headers)
                assert response.headers["content-security-policy"] == FRONTEND_CSP
        for path in ("/docs", "/redoc", "/openapi.json"):
            response = client.get(path)
            assert response.status_code == 200
            assert "content-security-policy" not in response.headers
        blocked = client.get("/private.json")
        assert blocked.status_code == 404
        assert "FAKE_PRIVATE_VALUE" not in blocked.text
        check_headers(blocked.headers)



def test_normal_chunked_request_is_replayed_without_changing_json(tmp_path, query):
    app = create_app(data_path=DATA_PATH, frontend_dir=tmp_path / "absent")
    payload = padded_request(query, MAX_REQUEST_BODY_BYTES)
    with TestClient(app) as client:
        expected = client.post("/api/recommendations", json=query).json()
        start, body, reads = asyncio.run(raw_request(
            app, [payload[:15], payload[15:500], payload[500:]],
            [(b"transfer-encoding", b"chunked")],
        ))
        assert start["status"] == 200
        assert body == expected
        assert reads == 3
        check_headers({k.decode(): v.decode() for k, v in start["headers"]})
