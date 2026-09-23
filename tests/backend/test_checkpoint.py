"""Checkpoint safety tests. Git writes/pushes are only to disposable local repositories."""
import io
from pathlib import Path
import subprocess

import pytest

from scripts import checkpoint as cp


@pytest.mark.parametrize("participant,branch", [("Dinmukhammed", "dev-dinmukhammed"), ("Ilyas", "dev-zoro"), ("Ilyas", "dev-ilyas")])
def test_personal_branch_mapping(participant, branch):
    cp.validate_request(participant, branch, "Useful checked change")


@pytest.mark.parametrize("participant,branch", [("Dinmukhammed", "main"), ("Ilyas", "integration"), ("Dinmukhammed", "dev-zoro"), ("Ilyas", "dev-dinmukhammed"), ("Unknown", "dev-test")])
def test_forbidden_branch_mapping(participant, branch):
    with pytest.raises(cp.Blocked, match="mismatch"):
        cp.validate_request(participant, branch, "Change")


@pytest.mark.parametrize("name", [".env", "backend/.env.example", "backend/credentials.json", "backend/secrets.toml", "backend/key.pem", "backend/key.key", "backend/id_rsa", "backend/.git/config", "../backend/app.py", "frontend/app.mjs", "docs/handoffs/ilyas.md", "tests/ui/test.mjs"])
def test_dinmukhammed_ownership_and_sensitive_paths(name):
    assert not cp.allowed_path("Dinmukhammed", name)


@pytest.mark.parametrize("name", ["frontend/app.mjs", "tests/ui/evidence/result.json", "docs/handoffs/ilyas.md", "docs/DEMO.md", "docs/EXPERT_CHECK.md"])
def test_ilyas_owned_paths(name):
    assert cp.allowed_path("Ilyas", name)


@pytest.mark.parametrize("name", ["docs/COMPLIANCE.md", "docs/STATE.md", "README.md", "backend/app.py", "frontend/.env.example"])
def test_ilyas_cannot_publish_shared_or_sensitive_paths(name):
    assert not cp.allowed_path("Ilyas", name)


@pytest.mark.parametrize("value", ["FAKE_TEST_VALUE", "DUMMY_TEST_VALUE", "PLACEHOLDER", "PLACEHOLDER_TEST_VALUE"])
def test_only_explicit_fake_literals_are_allowed(value):
    cp.scan_text(("api_key" + " = ") + repr(value))
    cp.scan_text(("API_KEY" + "=") + value)


@pytest.mark.parametrize("value", ["real-value", "some-FAKE_value", "FAKE value then real", "DUMMY_OK real-secret"])
def test_credential_assignments_are_rejected_without_echoing_value(value):
    with pytest.raises(cp.Blocked) as error:
        cp.scan_text(("api_key" + " = ") + repr(value))
    assert value not in str(error.value)


def test_fake_marker_does_not_exempt_other_credentials():
    detected_value = "ghp_" + "a" * 35
    with pytest.raises(cp.Blocked):
        cp.scan_text("DUMMY_example " + detected_value)
    with pytest.raises(cp.Blocked):
        cp.scan_text("password" + "=" + "live-value")
    with pytest.raises(cp.Blocked):
        cp.scan_text("-----BEGIN " + "PRIVATE KEY-----")


def test_current_script_is_scannable():
    cp.scan_bytes(Path(cp.__file__).read_bytes())


@pytest.mark.parametrize("data", [b"a\x00b", b"\xff"])
def test_nontext_requires_manual_review(data):
    with pytest.raises(cp.Blocked):
        cp.scan_bytes(data)


def local_git(root, *args):
    process = subprocess.run(["git", *args], cwd=root, capture_output=True, check=False)
    assert process.returncode == 0, process.stderr.decode(errors="replace")
    return process.stdout.decode().strip()


@pytest.fixture
def personal_repo(tmp_path, monkeypatch):
    bare = tmp_path / "remote.git"
    local_git(tmp_path, "init", "--bare", str(bare))
    work = tmp_path / "work"
    work.mkdir()
    local_git(work, "init", "-b", "dev-dinmukhammed")
    local_git(work, "config", "user.name", "Checkpoint Test")
    local_git(work, "config", "user.email", "checkpoint@example.invalid")
    local_git(work, "config", "core.autocrlf", "false")
    local_git(work, "config", "commit.gpgsign", "false")
    (work / "README.md").write_text("Initial\n", encoding="utf-8")
    local_git(work, "add", "README.md")
    local_git(work, "commit", "-m", "Initial fixture")
    local_git(work, "remote", "add", "origin", str(bare))
    local_git(work, "push", "origin", "HEAD:refs/heads/dev-dinmukhammed")
    # Explicit test-only origin injection; production has no bypass flag/environment.
    monkeypatch.setattr(cp, "ORIGINS", frozenset({str(bare)}))
    return cp.Git(work), bare


def no_runtime(_root):
    return {"backend_pytest": "PASS (test double)", "http_smoke": "PASS (test double)"}


def invoke(git, **kwargs):
    return cp.checkpoint(git, "Dinmukhammed", "dev-dinmukhammed", "Checked change", validator=no_runtime, **kwargs)


def test_default_check_does_not_stage_commit_or_push(personal_repo):
    git, _ = personal_repo
    old = git.text("rev-parse", "HEAD")
    (git.root / "README.md").write_text("Changed\n", encoding="utf-8")
    result = invoke(git)
    assert result["mode"] == "check-only"
    assert git.text("rev-parse", "HEAD") == cp.remote_sha(git, "dev-dinmukhammed") == old
    assert not git.run("diff", "--cached")
    assert git.run("diff")


def test_publish_to_disposable_personal_remote_only(personal_repo):
    git, bare = personal_repo
    old = git.text("rev-parse", "HEAD")
    (git.root / "README.md").write_text("Checked change\n", encoding="utf-8")
    result = invoke(git, publish=True)
    assert result["published_sha"] != old
    assert cp.remote_sha(git, "dev-dinmukhammed") == result["published_sha"]
    assert local_git(bare, "for-each-ref", "--format=%(refname)") == "refs/heads/dev-dinmukhammed"
    assert not git.run("status", "--porcelain")


def test_no_empty_commit(personal_repo):
    git, _ = personal_repo
    with pytest.raises(cp.Blocked, match="empty"):
        invoke(git, publish=True)


def test_unknown_origin_rejected_before_validator(personal_repo, monkeypatch):
    git, _ = personal_repo
    monkeypatch.setattr(cp, "ORIGINS", frozenset({"https://github.com/approved/exact.git"}))
    with pytest.raises(cp.Blocked, match="Origin"):
        invoke(git)


def test_push_url_is_also_validated(personal_repo):
    git, _ = personal_repo
    git.run("remote", "set-url", "--push", "origin", "https://example.invalid/elsewhere.git")
    with pytest.raises(cp.Blocked, match="Origin"):
        invoke(git)


@pytest.mark.parametrize("state", ["MERGE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "sequencer"])
def test_git_operation_blocks(personal_repo, state):
    git, _ = personal_repo
    path = git.root / git.text("rev-parse", "--git-path", state)
    if state in {"rebase-merge", "sequencer"}:
        path.mkdir()
    else:
        path.write_text(git.text("rev-parse", "HEAD"), encoding="utf-8")
    with pytest.raises(cp.Blocked, match="Unfinished"):
        invoke(git)


def test_existing_unpublished_commit_blocks_check_and_publish(personal_repo):
    git, _ = personal_repo
    (git.root / "README.md").write_text("Unreviewed\n", encoding="utf-8")
    git.run("add", "README.md")
    git.run("commit", "-m", "Unreviewed local commit")
    with pytest.raises(cp.Blocked, match="Unpublished"):
        invoke(git)


def test_foreign_untracked_file_blocks(personal_repo):
    git, _ = personal_repo
    (git.root / "frontend").mkdir()
    (git.root / "frontend/app.mjs").write_text("new design", encoding="utf-8")
    with pytest.raises(cp.Blocked, match="ownership"):
        invoke(git)


def test_staged_foreign_content_cannot_hide_under_reverted_worktree(personal_repo):
    git, _ = personal_repo
    (git.root / "frontend").mkdir()
    foreign = git.root / "frontend/app.mjs"
    foreign.write_text("new design", encoding="utf-8")
    git.run("add", "frontend/app.mjs")
    foreign.unlink()
    with pytest.raises(cp.Blocked, match="ownership"):
        invoke(git)


def test_rename_checks_both_old_and_new_paths(personal_repo):
    git, _ = personal_repo
    (git.root / "frontend").mkdir()
    (git.root / "README.md").rename(git.root / "frontend/app.mjs")
    assert cp.changed_paths(git) == ["README.md", "frontend/app.mjs"]
    with pytest.raises(cp.Blocked, match="ownership"):
        invoke(git)


def test_secret_in_staged_blob_cannot_hide_under_safe_worktree(personal_repo):
    git, _ = personal_repo
    value = "live-" + "credential-content"
    path = git.root / "README.md"
    path.write_text(("api_key" + " = ") + repr(value), encoding="utf-8")
    git.run("add", "README.md")
    path.write_text("Safe working tree", encoding="utf-8")
    with pytest.raises(cp.Blocked, match="Secret scan") as error:
        invoke(git)
    assert value not in str(error.value)


def test_worktree_race_blocks_before_staging(personal_repo):
    git, _ = personal_repo
    path = git.root / "README.md"
    path.write_text("Before tests", encoding="utf-8")
    def race(_root):
        path.write_text("Concurrent edit", encoding="utf-8")
        return {}
    with pytest.raises(cp.Blocked, match="changed during validation"):
        cp.checkpoint(git, "Dinmukhammed", "dev-dinmukhammed", "Change", publish=True, validator=race)
    assert not git.run("diff", "--cached")


def test_validation_failure_never_stages(personal_repo):
    git, _ = personal_repo
    (git.root / "README.md").write_text("Changed", encoding="utf-8")
    def failure(_root):
        raise cp.Blocked("Backend tests failed")
    with pytest.raises(cp.Blocked, match="tests failed"):
        cp.checkpoint(git, "Dinmukhammed", "dev-dinmukhammed", "Change", publish=True, validator=failure)
    assert not git.run("diff", "--cached")


def test_remote_advancing_during_tests_blocks(personal_repo, tmp_path):
    git, bare = personal_repo
    other = tmp_path / "other"
    local_git(tmp_path, "clone", "--branch", "dev-dinmukhammed", str(bare), str(other))
    local_git(other, "config", "user.name", "Other Test")
    local_git(other, "config", "user.email", "other@example.invalid")
    local_git(other, "config", "commit.gpgsign", "false")
    def race(_root):
        (other / "README.md").write_text("Remote new work", encoding="utf-8")
        local_git(other, "add", "README.md")
        local_git(other, "commit", "-m", "Remote advance")
        local_git(other, "push", "origin", "HEAD:refs/heads/dev-dinmukhammed")
        return {}
    with pytest.raises(cp.Blocked, match="ahead|diverged|changed"):
        cp.checkpoint(git, "Dinmukhammed", "dev-dinmukhammed", "Change", publish=True, validator=race)
    assert not git.run("diff", "--cached")


def test_cleanup_own_server_even_when_smoke_fails(tmp_path, monkeypatch):
    calls = []
    def checked(root, args, label, timeout):
        calls.append((args, label))
        if label == "HTTP smoke":
            raise cp.Blocked("Smoke failed")
    class Process:
        pid = 424242
        stdout = io.StringIO("32123\n")
        stopped = False
        def poll(self):
            return 0 if self.stopped else None
        def terminate(self):
            self.stopped = True
        def wait(self, timeout):
            return 0
    process = Process()
    class Response(io.StringIO):
        def __enter__(self):
            return self
        def __exit__(self, *args):
            self.close()
    def stop_tree(args, **kwargs):
        assert args == ["taskkill", "/PID", "424242", "/T", "/F"]
        process.stopped = True
        return subprocess.CompletedProcess(args, 0)
    monkeypatch.setattr(cp.subprocess, "run", stop_tree)
    monkeypatch.setattr(cp, "checked_process", checked)
    monkeypatch.setattr(cp.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(cp, "urlopen", lambda *args, **kwargs: Response('{"status":"ok"}'))
    with pytest.raises(cp.Blocked, match="Smoke failed"):
        cp.run_validation(tmp_path)
    assert process.stopped
    assert calls[0][0][-2:] == ["tests/backend", "-q"]
    assert "http://127.0.0.1:32123" in calls[1][0]

def test_push_pins_checked_commit_even_if_head_moves(personal_repo, monkeypatch):
    git, _ = personal_repo
    (git.root / "README.md").write_text("Checked content", encoding="utf-8")
    original_run = git.run
    injected = []
    def race(*args, **kwargs):
        if args and args[0] == "push":
            assert not args[-1].startswith("HEAD:")
            (git.root / "README.md").write_text("Concurrent untested work", encoding="utf-8")
            original_run("add", "README.md")
            original_run("commit", "-m", "Concurrent local commit")
            injected.append(original_run("rev-parse", "HEAD").decode().strip())
        return original_run(*args, **kwargs)
    monkeypatch.setattr(git, "run", race)
    result = invoke(git, publish=True)
    assert injected and result["published_sha"] != injected[0]
    assert cp.remote_sha(git, "dev-dinmukhammed") == result["published_sha"]
    assert git.text("rev-parse", "HEAD") == injected[0]


def test_all_checkpoint_deliverables_pass_own_secret_heuristic():
    root = Path(cp.__file__).resolve().parents[1]
    for name in ("scripts/checkpoint.py", "tests/backend/test_checkpoint.py", "docs/CHECKPOINT.md"):
        cp.scan_bytes((root / name).read_bytes())

def test_unquoted_spaced_credential_is_not_ignored():
    with pytest.raises(cp.Blocked, match="unquoted"):
        cp.scan_text("password" + ": a nontrivial secret phrase")
