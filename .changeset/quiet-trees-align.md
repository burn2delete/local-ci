---
"run-local-ci": patch
"dtu-github-actions": patch
---

Use the actual run's GitHub context for step expressions; retain actual dependency results (including matrix/reusable jobs); import real source snapshot history into runner workspaces; and scope checkout emulation to the Actions workspace while preserving normal Git object queries and edits.

Closes #393. Closes #394. Closes #395. Closes #396.
