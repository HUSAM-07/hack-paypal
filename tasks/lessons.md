
## 2026-11-13: "merge when green" merged immediately
- `gh pr merge --auto` only waits for *required* status checks. This repo's `main` has none, so it merged PR #170 at once while CI was still running.
- Rule: to merge when green here, wait for the PR's checks to finish (one blocking `gh pr checks <n> --watch --fail-fast` in the background), then `gh pr merge` explicitly. Check `gh api repos/{owner}/{repo}/branches/main/protection` before relying on `--auto`.
- Safety net that held: `deploy` in ci.yml `needs: check`, so nothing deploys unless CI on main passes.
