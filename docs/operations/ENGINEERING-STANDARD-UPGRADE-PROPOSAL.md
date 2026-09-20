# Proposed Engineering Standard Upgrade

Feedback from production operations should be applied to the Engineering
Standard repository separately. Recommended technology-neutral requirements:

1. Production-critical procedures must be version-controlled documentation or
   automation; AI conversations and shell history are never authoritative.
2. Classify commands as repository-automated, authoritative operator,
   diagnostic, break-glass, or historical/incident-specific.
3. Prefer auditable scripts/tasks for deterministic multi-command workflows and
   require runbooks to state inputs, outputs, failure behavior, and rollback.
4. Require a master cookbook for production-capable projects.
5. Require a clean-environment disaster-recovery acceptance criterion covering
   surviving backups, owner-controlled secrets/material, replacement
   infrastructure, restoration, and post-restore verification.
6. Require generated release evidence to be durably stored, hash-verifiable,
   payload-bound, and recoverable after infrastructure loss.
7. Treat operational reproducibility as part of feature completion, not a
   post-release documentation task.
8. Operational commands used during real deployment, certification, restore,
   shipping, and recovery must be captured either as an authoritative
   automation task or as a documented manual equivalent. AI chat history and
   shell history must never be the only record. One-off exploratory searches or
   debugging commands need not be recorded unless they become a known
   troubleshooting procedure.
