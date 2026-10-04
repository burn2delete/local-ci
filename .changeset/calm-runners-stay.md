---
"run-local-ci": minor
"dtu-github-actions": minor
---

Allow shared-Docker-daemon callers to disable global startup cleanup with LOCAL_CI_SKIP_GLOBAL_CLEANUP=1 while retaining cleanup of each run's own resources.

Closes #397.
