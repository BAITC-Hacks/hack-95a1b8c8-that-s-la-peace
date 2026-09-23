"""Run the API and, when present, the team's frontend from one origin."""
import argparse
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description="That's La Peace local server")
    parser.add_argument("--port", type=int, default=8000, help="Local port (default: 8000)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: loopback)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    try:
        import uvicorn
    except ImportError:
        parser.exit(1, "Dependencies are missing. Activate .venv and run: python -m pip install -r requirements.txt\n")
    # Running this absolute script from another directory still imports this checkout.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    uvicorn.run("backend.app:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
