# Development guidance

- Read `README.md`, `docs/development.md` and `docs/testing.md` for setup and checks.
- Use feature branches and PRs. Preserve CI and maintainer review requirements.
- Run `pnpm verify` and relevant production/integration tests for code changes.
- Keep credentials in ignored environment files, never source, logs or evidence.
- Keep `.neander/compose.yaml`, committed migrations and runtime requirements in
  sync. Preserve the public health route, existing template IDs and MIT license.
- Use isolated PostgreSQL databases and fictional identities/documents for tests.
  Never seed, reset or run verification against a customer workspace/database.
- Scope local Docker Compose commands with an explicit unique `-p` and `-f`;
  preserve existing development files, volumes and data.
- Keep existing deployment provider requirements (`provider: null` where required)
  and the recipe validation fast path; do not add generic Neon-hostname restrictions.
- Report local/CI checks separately from managed Neon, Cloud Run and desktop
  Neander Publish verification. Publish without bypassing protected-main rules.
- Before Next.js changes, read the relevant installed `node_modules/next/dist/docs/` guide.
