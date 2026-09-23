"""Launcher regression checks; no real browser, HTTP request or server is started."""
import builtins
import io
import json
from pathlib import Path
import socket
from types import SimpleNamespace

import pytest

from scripts import jury_launcher as launcher


REQUIRED_FILES = (
    "data/contractors.csv", "frontend/index.html", "frontend/styles.css",
    "frontend/view.mjs", "frontend/api.mjs", "frontend/app.mjs",
    "frontend/i18n.mjs", "frontend/search-select.mjs", "frontend/catalog-guide.json",
)


@pytest.fixture
def bundle(tmp_path):
    for name in REQUIRED_FILES:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("fixture", encoding="utf-8")
    return tmp_path


def test_source_resource_root(monkeypatch):
    monkeypatch.delattr(launcher.sys, "_MEIPASS", raising=False)
    assert launcher.resource_root() == Path(launcher.__file__).resolve().parents[1]


def test_frozen_resource_root(monkeypatch, tmp_path):
    extracted = tmp_path / "extracted application"
    monkeypatch.setattr(launcher.sys, "_MEIPASS", str(extracted), raising=False)
    assert launcher.resource_root() == extracted


def test_complete_bundle_files_are_accepted(bundle):
    assert launcher.validate_bundle(bundle) is None


@pytest.mark.parametrize("name", REQUIRED_FILES)
def test_each_required_file_is_checked(bundle, name):
    (bundle / name).unlink()
    with pytest.raises(FileNotFoundError) as failure:
        launcher.validate_bundle(bundle)
    assert str(failure.value) == "Project files are missing: " + name


def test_directory_does_not_substitute_required_file(bundle):
    index = bundle / "frontend/index.html"
    index.unlink()
    index.mkdir()
    with pytest.raises(FileNotFoundError, match="frontend/index.html"):
        launcher.validate_bundle(bundle)


def test_reserved_socket_is_loopback_only_and_closed():
    with launcher.reserve_local_socket(0) as listener:
        address, port = listener.getsockname()
        assert address == "127.0.0.1"
        assert 0 < port <= 65535
        assert listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) == 1
    assert listener.fileno() == -1


def test_busy_preferred_port_uses_another_local_port_and_closes_both():
    with launcher.reserve_local_socket(0) as occupied:
        preferred = occupied.getsockname()[1]
        with launcher.reserve_local_socket(preferred) as fallback:
            assert fallback.getsockname()[0] == "127.0.0.1"
            assert fallback.getsockname()[1] != preferred
            assert occupied.fileno() != -1
        assert fallback.fileno() == -1
    assert occupied.fileno() == -1


@pytest.mark.parametrize("port", [-1, 65536])
def test_invalid_port_rejected_before_socket_creation(monkeypatch, port):
    def forbidden_socket(*args):
        pytest.fail("Invalid input must not allocate a socket")
    monkeypatch.setattr(launcher.socket, "socket", forbidden_socket)
    with pytest.raises(ValueError, match="between 0 and 65535"):
        launcher.reserve_local_socket(port)


@pytest.mark.parametrize("port,stage,expected_binds", [
    (0, "bind", [("127.0.0.1", 0)]),
    (8000, "bind", [("127.0.0.1", 8000), ("127.0.0.1", 0)]),
    (0, "listen", [("127.0.0.1", 0)]),
])
def test_socket_closed_when_binding_or_listening_fails(monkeypatch, port, stage, expected_binds):
    calls = []
    state = {"closed": False}

    def bind(address):
        calls.append(address)
        if stage == "bind":
            raise OSError("local bind failed")

    def listen(backlog):
        assert backlog == 128
        if stage == "listen":
            raise OSError("local listen failed")

    listener = SimpleNamespace(
        bind=bind, listen=listen, setsockopt=lambda *args: None,
        close=lambda: state.update(closed=True),
    )
    monkeypatch.setattr(launcher.socket, "socket", lambda *args: listener)
    with pytest.raises(OSError, match="local (bind|listen) failed"):
        launcher.reserve_local_socket(port)
    assert calls == expected_binds
    assert state["closed"]


class PollClock:
    def __init__(self):
        self.now = 0
        self.stopped = False
        self.waits = []
        self.stop_after_wait = False

    def is_set(self):
        return self.stopped

    def wait(self, seconds):
        self.waits.append(seconds)
        self.now += seconds
        if self.stop_after_wait:
            self.stopped = True
        return self.stopped


def fake_health_checks(monkeypatch, responses):
    clock = PollClock()
    opened = []
    requests = []
    handlers = []
    iterator = iter(responses)

    def open_health(url, timeout):
        requests.append((url, timeout))
        item = next(iterator)
        if isinstance(item, Exception):
            raise item
        return io.StringIO(item if isinstance(item, str) else json.dumps(item))

    def build_opener(handler):
        handlers.append(handler)
        return SimpleNamespace(open=open_health)

    monkeypatch.setattr(launcher.urllib.request, "build_opener", build_opener)
    monkeypatch.setattr(launcher.webbrowser, "open", lambda url: opened.append(url))
    monkeypatch.setattr(launcher.time, "monotonic", lambda: clock.now)
    return clock, opened, requests, handlers


def test_browser_waits_for_healthy_expected_dataset_without_proxy(monkeypatch):
    clock, opened, requests, handlers = fake_health_checks(monkeypatch, [
        OSError("not listening yet"), "not valid JSON",
        {"status": "starting", "dataset_count": 66},
        {"status": "ok", "dataset_count": 65},
        {"status": "ok"},
        {"status": "ok", "dataset_count": 66},
    ])
    url = "http://127.0.0.1:43210/"
    launcher.open_when_ready(url, clock)
    assert requests == [(url + "api/health", 1)] * 6
    assert clock.waits == [0.1] * 5
    assert opened == [url]
    assert len(handlers) == 1
    assert isinstance(handlers[0], launcher.urllib.request.ProxyHandler)
    assert handlers[0].proxies == {}


def test_browser_timeout_prints_manual_address_without_opening(monkeypatch, capsys):
    clock, opened, requests, _ = fake_health_checks(
        monkeypatch, [{"status": "ok", "dataset_count": 0}] * 3,
    )
    url = "http://127.0.0.1:43210/"
    launcher.open_when_ready(url, clock, timeout=0.25)
    assert len(requests) == 3
    assert not opened
    assert "did not open automatically" in capsys.readouterr().out


@pytest.mark.parametrize("already_stopped", [True, False])
def test_stopped_launcher_neither_opens_browser_nor_reports_timeout(monkeypatch, capsys, already_stopped):
    clock, opened, requests, _ = fake_health_checks(monkeypatch, [OSError("not ready")])
    clock.stopped = already_stopped
    clock.stop_after_wait = True
    launcher.open_when_ready("http://127.0.0.1:43210/", clock)
    assert len(requests) == (0 if already_stopped else 1)
    assert not opened
    assert capsys.readouterr().out == ""


@pytest.mark.parametrize("port", ["-1", "65536"])
def test_main_invalid_port_fails_before_bundle_check(monkeypatch, capsys, port):
    monkeypatch.setattr(launcher, "resource_root", lambda: pytest.fail("Invalid port must fail first"))
    with pytest.raises(SystemExit) as failure:
        launcher.main(["--port", port, "--no-browser"])
    assert failure.value.code == 2
    assert "between 0 and 65535" in capsys.readouterr().err


def test_main_reports_missing_bundle_files(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(launcher, "resource_root", lambda: tmp_path)
    assert launcher.main(["--no-browser"]) == 1
    output = capsys.readouterr().err
    assert "Cannot start the local demo" in output
    assert "data/contractors.csv" in output
    assert "README.md" in output


def test_main_reports_missing_runtime_dependency(monkeypatch, bundle, capsys):
    monkeypatch.setattr(launcher, "resource_root", lambda: bundle)
    monkeypatch.setattr(launcher.sys, "path", list(launcher.sys.path))
    real_import = builtins.__import__

    def import_without_uvicorn(name, *args, **kwargs):
        if name == "uvicorn":
            raise ImportError("uvicorn unavailable")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", import_without_uvicorn)
    assert launcher.main(["--no-browser"]) == 1
    assert "uvicorn unavailable" in capsys.readouterr().err


def test_main_reports_invalid_catalog_before_socket_or_browser(monkeypatch, bundle, capsys):
    from backend import catalog
    monkeypatch.setattr(launcher, "resource_root", lambda: bundle)
    monkeypatch.setattr(launcher.sys, "path", list(launcher.sys.path))

    def reject_catalog(path):
        assert path == bundle / "data/contractors.csv"
        raise ValueError("invalid catalogue fixture")

    monkeypatch.setattr(catalog, "load_catalog", reject_catalog)
    monkeypatch.setattr(launcher, "reserve_local_socket", lambda port: pytest.fail("Invalid data must fail before listening"))
    monkeypatch.setattr(launcher.webbrowser, "open", lambda url: pytest.fail("Invalid data must not open a browser"))
    assert launcher.main(["--no-browser"]) == 1
    assert "invalid catalogue fixture" in capsys.readouterr().err
