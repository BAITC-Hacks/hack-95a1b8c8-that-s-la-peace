"""Offline Windows entry point; also usable with an installed Python runtime."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request
import webbrowser


def resource_root() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))


def validate_bundle(root: Path) -> None:
    required = ["data/contractors.csv"] + [
        "frontend/" + name for name in (
            "index.html", "styles.css", "view.mjs", "api.mjs", "app.mjs",
            "i18n.mjs", "search-select.mjs", "catalog-guide.json",
        )
    ]
    missing = [name for name in required if not (root / name).is_file()]
    if missing:
        raise FileNotFoundError("Project files are missing: " + ", ".join(missing))


def reserve_local_socket(port: int) -> socket.socket:
    if not 0 <= port <= 65535:
        raise ValueError("Port must be between 0 and 65535")
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    try:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError:
            if port == 0:
                raise
            # Never stop another application or reuse its unknown response.
            listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        return listener
    except BaseException:
        listener.close()
        raise


def open_when_ready(url: str, stopped: threading.Event, timeout: float = 30) -> None:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + timeout
    while not stopped.is_set() and time.monotonic() < deadline:
        try:
            with opener.open(url + "api/health", timeout=1) as response:
                health = json.load(response)
            if health.get("status") == "ok" and health.get("dataset_count") == 66:
                webbrowser.open(url)
                return
        except (OSError, ValueError):
            pass
        stopped.wait(0.1)
    if not stopped.is_set():
        print("The browser did not open automatically. Check the server message and open " + url, flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="That's La Peace: offline local demo")
    parser.add_argument("--port", type=int, default=8000, help="Preferred local port; a busy port is replaced automatically")
    parser.add_argument("--no-browser", action="store_true", help="Print the address without opening the browser")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    root = resource_root()
    try:
        validate_bundle(root)
        sys.path.insert(0, str(root))
        import uvicorn
        from backend.app import create_app
        from backend.catalog import load_catalog
        load_catalog(root / "data" / "contractors.csv")
    except (ImportError, OSError, ValueError) as error:
        print("Cannot start the local demo: " + str(error), file=sys.stderr)
        print("Use the complete Windows package or follow the source setup in README.md.", file=sys.stderr)
        return 1
    stopped = threading.Event()
    with reserve_local_socket(args.port) as listener:
        port = listener.getsockname()[1]
        url = f"http://127.0.0.1:{port}/"
        print("That's La Peace", flush=True)
        print("Open " + url, flush=True)
        print("No account, API key or internet connection is needed. Stop: Ctrl+C or close this console.", flush=True)
        if not args.no_browser:
            threading.Thread(target=open_when_ready, args=(url, stopped), daemon=True).start()
        config = uvicorn.Config(
            create_app(data_path=root / "data" / "contractors.csv", frontend_dir=root / "frontend"),
            host="127.0.0.1", port=port, loop="asyncio", http="h11", ws="none",
            lifespan="on", access_log=False, log_level="info",
        )
        try:
            uvicorn.Server(config).run(sockets=[listener])
        finally:
            stopped.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
