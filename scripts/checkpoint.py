"""One-shot personal checkpoint. Default: checks only; never publishes shared branches."""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import queue
import re
import subprocess
import sys
import threading
import time
from urllib.request import urlopen
import uuid

REPOSITORY = "BAITC-Hacks/hack-95a1b8c8-that-s-la-peace"
ORIGINS = frozenset({
    f"https://github.com/{REPOSITORY}", f"https://github.com/{REPOSITORY}.git",
    f"git@github.com:{REPOSITORY}", f"git@github.com:{REPOSITORY}.git",
    f"ssh://git@github.com/{REPOSITORY}", f"ssh://git@github.com/{REPOSITORY}.git",
})
BRANCHES = {"Dinmukhammed": {"dev-dinmukhammed"}, "Ilyas": {"dev-ilyas", "dev-zoro"}}
FRIEND_DOCS = {"docs/DEMO.md", "docs/EXPERT_CHECK.md", "docs/handoffs/ilyas.md"}
ROOT_FILES = {"README.md", "AGENTS.md", ".gitignore", "run.py", "requirements.txt", "requirements-dev.txt", "pyproject.toml", "pytest.ini"}
IN_PROGRESS = ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-apply", "rebase-merge", "sequencer", "BISECT_START")
TOKEN_PATTERN = re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{16,})")
ASSIGNMENT = re.compile(r'''(?i)["']?\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|client[_-]?secret|aws[_-]?secret[_-]?access[_-]?key)["']?\s*[:=]\s*(["'])([^\r\n]*?)\1''')
UNQUOTED = re.compile(r"(?im)^\s*(?:export\s+)?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|client[_-]?secret|aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*([^\s'\"#][^\r\n#]*)$")
FAKE = re.compile(r"(?:FAKE_|DUMMY_|PLACEHOLDER)[A-Za-z0-9_.-]*\Z")


class Blocked(RuntimeError):
    """Contains only safe, deliberately written diagnostics, never command output."""


def validate_request(participant: str, branch: str, summary: str) -> None:
    if participant not in BRANCHES or branch not in BRANCHES[participant]:
        raise Blocked("Participant/branch mismatch; main and integration are never allowed")
    if not summary.strip() or len(summary) > 200 or "\n" in summary or "\r" in summary:
        raise Blocked("Summary must be one meaningful line of 1–200 characters")
    scan_text(summary)


def allowed_path(participant: str, name: str) -> bool:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(p in ("..", ".") for p in path.parts):
        return False
    if "\\" in name or ":" in name or any(ord(c) < 32 for c in name):
        return False
    lowered = [part.lower() for part in path.parts]
    for part in lowered:
        if (part in {".git", ".ssh", ".aws", ".netrc", ".npmrc", ".pypirc", "auth.json"}
                or part == ".env" or part.startswith(".env.")
                or part.startswith(("id_rsa", "id_dsa", "id_ed25519", "id_ecdsa", "credentials", "secrets."))
                or part.endswith((".pem", ".key", ".p12", ".pfx"))):
            return False
    if participant == "Ilyas":
        return name.startswith(("frontend/", "tests/ui/")) or name in FRIEND_DOCS
    if participant == "Dinmukhammed":
        return (name in ROOT_FILES or name.startswith(("backend/", "data/", "scripts/", "tests/backend/", "tests/integration/", "docs/"))) and name not in FRIEND_DOCS
    return False


def scan_text(text: str) -> None:
    if re.search(r"-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----", text):
        raise Blocked("Secret scan: private-key material detected (value hidden)")
    # A marker exempts only that literal value; it never exempts the whole line/file.
    for match in ASSIGNMENT.finditer(text):
        value = match.group(2).strip()
        if value and not FAKE.fullmatch(value):
            raise Blocked("Secret scan: credential assignment detected (value hidden)")
    for match in UNQUOTED.finditer(text):
        value = match.group(1).strip()
        if value and not FAKE.fullmatch(value):
            raise Blocked("Secret scan: unquoted credential assignment detected (value hidden)")
    without_fake = re.sub(r"\b(?:FAKE_|DUMMY_|PLACEHOLDER)[A-Za-z0-9_.-]*\b", "", text)
    if TOKEN_PATTERN.search(without_fake) or re.search(r"https?://[^\s/@:]+:[^\s/@]+@", text):
        raise Blocked("Secret scan: token or embedded credentials detected (value hidden)")


def scan_bytes(data: bytes) -> None:
    if b"\0" in data:
        raise Blocked("Binary change requires manual review; checkpoint cannot scan it")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise Blocked("Non-UTF-8 change requires manual review") from None
    scan_text(text)


class Git:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def run(self, *args: str, ok: bool = True) -> bytes:
        try:
            result = subprocess.run(["git", "--literal-pathspecs", *args], cwd=self.root,
                                    capture_output=True, timeout=90, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise Blocked(f"Git {args[0]} could not complete; no raw output retained") from None
        if ok and result.returncode:
            raise Blocked(f"Git {args[0]} failed; inspect locally, output hidden")
        return result.stdout

    def text(self, *args: str) -> str:
        return self.run(*args).decode("utf-8", errors="strict").strip()


def verify_identity(git: Git, branch: str) -> None:
    if Path(git.text("rev-parse", "--show-toplevel")).resolve() != git.root:
        raise Blocked("Run from the exact repository root")
    if git.text("symbolic-ref", "--quiet", "--short", "HEAD") != branch:
        raise Blocked("Current branch differs from the requested personal branch")
    for args in (("remote", "get-url", "--all", "origin"), ("remote", "get-url", "--push", "--all", "origin")):
        urls = git.text(*args).splitlines()
        if len(urls) != 1 or urls[0] not in ORIGINS:
            raise Blocked("Origin must be the exact approved GitHub repository with one fetch/push URL")
    for state in IN_PROGRESS:
        path = Path(git.text("rev-parse", "--git-path", state))
        if not path.is_absolute():
            path = git.root / path
        if path.exists():
            raise Blocked(f"Unfinished Git operation: {state}")
    if git.run("diff", "--name-only", "--diff-filter=U", "-z"):
        raise Blocked("Unresolved merge conflicts")


def remote_sha(git: Git, branch: str) -> str | None:
    output = git.text("ls-remote", "--heads", "origin", f"refs/heads/{branch}")
    if not output:
        return None
    lines = output.splitlines()
    if len(lines) != 1:
        raise Blocked("Unexpected remote branch response")
    sha, ref = lines[0].split()
    if not re.fullmatch(r"[0-9a-f]{40,64}", sha) or ref != f"refs/heads/{branch}":
        raise Blocked("Unexpected remote branch identity")
    return sha


def verify_remote(git: Git, branch: str) -> str:
    remote = remote_sha(git, branch)
    if remote is None:
        raise Blocked("Remote personal branch is absent; create/review its initial publication manually")
    git.run("fetch", "--no-tags", "origin", f"refs/heads/{branch}:refs/remotes/origin/{branch}")
    fetched = git.text("rev-parse", f"refs/remotes/origin/{branch}")
    if fetched != remote:
        raise Blocked("Remote moved during fetch; rerun checkpoint")
    counts = git.text("rev-list", "--left-right", "--count", f"HEAD...{fetched}").split()
    if len(counts) != 2:
        raise Blocked("Could not determine branch relationship")
    ahead, behind = map(int, counts)
    if behind:
        raise Blocked("Remote is ahead or branches diverged; integrate deliberately before checkpoint")
    if ahead:
        raise Blocked("Unpublished local commits need separate manual review; checkpoint requires HEAD equal to remote")
    return fetched


def zero_names(data: bytes) -> set[str]:
    try:
        return {item.decode("utf-8") for item in data.split(b"\0") if item}
    except UnicodeDecodeError:
        raise Blocked("Non-UTF-8 filename requires manual review") from None


def changed_paths(git: Git) -> list[str]:
    return sorted(zero_names(git.run("diff", "--no-renames", "--name-only", "-z", "HEAD", "--"))
                  | zero_names(git.run("diff", "--cached", "--no-renames", "--name-only", "-z", "HEAD", "--"))
                  | zero_names(git.run("ls-files", "--others", "--exclude-standard", "-z")))


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class Snapshot:
    head: str
    branch: str
    status: str
    index: str
    files: tuple[tuple[str, str], ...]


def snapshot(git: Git, participant: str) -> Snapshot:
    names = changed_paths(git)
    fingerprints = []
    for name in names:
        scan_text(name)
        if not allowed_path(participant, name):
            raise Blocked(f"Blocked path or another participant's ownership: {name}")
        path = git.root / name
        if any(item.is_symlink() for item in (path, *path.parents) if item != git.root.parent):
            raise Blocked("Symlink change requires manual review")
        if not path.resolve().is_relative_to(git.root):
            raise Blocked("Changed path escapes the repository")
        if path.exists():
            if not path.is_file():
                raise Blocked("Directory/submodule change requires manual review")
            if path.stat().st_size > 5_000_000:
                raise Blocked("Large change requires manual secret review")
            data = path.read_bytes()
            scan_bytes(data)
            fingerprints.append((name, digest(data)))
        else:
            fingerprints.append((name, "deleted"))
        entries = git.run("ls-files", "--stage", "-z", "--", name).split(b"\0")
        for entry in filter(None, entries):
            metadata, _ = entry.split(b"\t", 1)
            mode, sha, stage = metadata.split()
            if mode not in (b"100644", b"100755") or stage != b"0":
                raise Blocked("Non-regular or conflicted staged file requires manual review")
            scan_bytes(git.run("cat-file", "blob", sha.decode("ascii")))
    return Snapshot(git.text("rev-parse", "HEAD"), git.text("symbolic-ref", "--short", "HEAD"),
                    digest(git.run("status", "--porcelain=v1", "-z", "--untracked-files=all")),
                    digest(git.run("diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--")),
                    tuple(fingerprints))


def checked_process(root: Path, args: list[str], label: str, timeout: int) -> None:
    try:
        result = subprocess.run(args, cwd=root, capture_output=True, timeout=timeout, check=False,
                                env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": str(root)})
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked(f"{label} did not complete; no raw output retained") from None
    if result.returncode:
        raise Blocked(f"{label} failed (exit {result.returncode}); inspect locally, output hidden")


SERVER = """
import socket, uvicorn
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.bind(('127.0.0.1', 0))
sock.listen(128)
print(sock.getsockname()[1], flush=True)
config = uvicorn.Config('backend.app:app', log_level='error')
uvicorn.Server(config).run(sockets=[sock])
"""


def run_validation(root: Path) -> dict:
    started = time.monotonic()
    checked_process(root, [sys.executable, "-m", "pytest", "tests/backend", "-q"], "Full backend pytest", 180)
    process = subprocess.Popen([sys.executable, "-c", SERVER], cwd=root, stdout=subprocess.PIPE,
                               stderr=subprocess.DEVNULL, text=True,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                               env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": str(root)})
    try:
        lines: queue.Queue[str] = queue.Queue()
        threading.Thread(target=lambda: lines.put(process.stdout.readline()), daemon=True).start()
        try:
            first = lines.get(timeout=10).strip()
        except queue.Empty:
            raise Blocked("Temporary server did not report its reserved port") from None
        if not first.isdigit() or not 1 <= int(first) <= 65535:
            raise Blocked("Temporary server did not start on a valid port")
        base = f"http://127.0.0.1:{first}"
        deadline = time.monotonic() + 15
        while True:
            if process.poll() is not None:
                raise Blocked("Temporary server exited before readiness")
            try:
                with urlopen(base + "/api/health", timeout=0.5) as response:
                    if json.load(response).get("status") == "ok":
                        break
            except (OSError, ValueError):
                pass
            if time.monotonic() >= deadline:
                raise Blocked("Temporary server readiness timed out")
            time.sleep(0.1)
        checked_process(root, [sys.executable, "scripts/smoke.py", "--base-url", base], "HTTP smoke", 60)
        return {"backend_pytest": "PASS", "http_smoke": "PASS", "server": "own process / reserved loopback port", "seconds": round(time.monotonic() - started, 3)}
    finally:
        if process.poll() is None:
            if os.name == "nt":
                # A Windows venv python.exe may be a launcher with a server child.
                # Kill only the tree rooted at the PID created above, never by name/port.
                try:
                    stopped = subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                                             capture_output=True, timeout=10, check=False,
                                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
                    if stopped.returncode and process.poll() is None:
                        raise Blocked("Could not stop own temporary server process tree")
                    process.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    raise Blocked("Could not confirm cleanup of own temporary server tree") from None
            else:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        if process.stdout:
            process.stdout.close()


def checkpoint(git: Git, participant: str, branch: str, summary: str, publish: bool = False,
               validator=run_validation) -> dict:
    validate_request(participant, branch, summary)
    verify_identity(git, branch)
    remote = verify_remote(git, branch)
    before = snapshot(git, participant)
    checks = validator(git.root)
    verify_identity(git, branch)
    if snapshot(git, participant) != before:
        raise Blocked("Working tree, index or HEAD changed during validation; no commit/push performed")
    if verify_remote(git, branch) != remote:
        raise Blocked("Remote changed during validation; rerun checkpoint")
    result = {"status": "PASS", "mode": "publish" if publish else "check-only", "participant": participant,
              "branch": branch, "head_before": before.head, "checks": checks,
              "files": [name for name, _ in before.files], "snapshot_sha256": digest(json.dumps(asdict(before), sort_keys=True).encode())}
    if not publish:
        return result
    if not before.files:
        raise Blocked("No meaningful owned changes; empty checkpoint commits are forbidden")
    names = [name for name, _ in before.files]
    git.run("add", "--all", "--", *names)
    staged = snapshot(git, participant)
    if staged.head != before.head or staged.branch != before.branch or staged.files != before.files:
        raise Blocked("Working tree or HEAD changed while staging; inspect the index, nothing pushed")
    patch = git.run("diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--")
    if not patch:
        raise Blocked("No meaningful staged change; empty commit forbidden")
    verify_identity(git, branch)
    if verify_remote(git, branch) != remote or snapshot(git, participant) != staged:
        raise Blocked("Repository changed before commit; inspect the index, nothing pushed")
    git.run("commit", "-m", f"checkpoint({participant}): {summary.strip()}")
    head = git.text("rev-parse", "HEAD")
    if git.text("rev-list", "--parents", "-n", "1", "HEAD").split() != [head, before.head]:
        raise Blocked("Unexpected commit parent; nothing pushed")
    committed_patch = git.run("diff", "--binary", "--no-ext-diff", "--no-textconv", before.head, head, "--")
    if committed_patch != patch or git.run("status", "--porcelain=v1", "-z", "--untracked-files=all"):
        raise Blocked("Commit hooks or concurrent work changed the validated result; commit remains local")
    verify_identity(git, branch)
    if remote_sha(git, branch) != remote:
        raise Blocked("Remote moved before push; checked commit remains local")
    git.run("push", "--porcelain", "origin", f"{head}:refs/heads/{branch}")
    if remote_sha(git, branch) != head:
        raise Blocked("Push result could not be confirmed; inspect remote before any retry")
    result["published_sha"] = head
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--participant", required=True, choices=sorted(BRANCHES))
    parser.add_argument("--branch", required=True)
    parser.add_argument("--summary", required=True)
    parser.add_argument("--publish", action="store_true", help="Commit and push only the checked personal change")
    args = parser.parse_args(argv)
    git = Git(Path(__file__).resolve().parents[1])
    try:
        result = checkpoint(git, args.participant, args.branch, args.summary, args.publish)
    except (Blocked, OSError, UnicodeError) as error:
        # OSError/UnicodeError can embed paths or input; do not echo them.
        reason = str(error) if isinstance(error, Blocked) else "Local filesystem or encoding error; inspect locally"
        result = {"status": "BLOCKED", "mode": "publish" if args.publish else "check-only", "reason": reason}
    result["timestamp_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    try:
        evidence_dir = Path(git.text("rev-parse", "--git-path", "checkpoint-evidence"))
        if not evidence_dir.is_absolute():
            evidence_dir = git.root / evidence_dir
        evidence_dir.mkdir(parents=True, exist_ok=True)
        evidence_path = evidence_dir / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:8] + ".json")
        evidence_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (Blocked, OSError):
        result["evidence"] = "Could not write local JSON evidence"
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
