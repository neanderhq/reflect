# Security

Please report a suspected vulnerability through this repository's **Security →
Report a vulnerability** page. This opens a private GitHub advisory for the
maintainers. Avoid posting exploit details, credentials or personal data in a
public issue. Include the affected revision, reproduction steps and impact.

The maintained version is the current `main` branch. Dependabot, CodeQL, secret
scanning and push protection are enabled. Pull requests and daily jobs audit the
complete dependency lockfile; dependency review rejects newly introduced known
advisories. Weekly Dependabot pull requests keep dependencies, Actions and Docker
bases current. Updates still need application tests and review.

Neander's private publisher builds and verifies the exact source commit before
registering it. Production service images are scanned before publication and
registered image digests are rescanned daily. Findings require remediation and
republication; an old release does not become patched automatically. Repository
scans cannot prove that an application has no vulnerabilities.

Use fictional sample data and unique generated deployment secrets. Never commit
real workspace data, credentials, `.env` files or provider tokens. Configure
external integrations in your own deployment and keep their permissions scoped.
