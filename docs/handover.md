# Reflect operations

Reflect supports HR, manager and employee review workflows. Each template deployment owns its database, accounts, email provider and scheduler configuration. No original workspace records or provider credentials are included.

## Email and reminders

Email is disabled until the owner configures `EMAIL_PROVIDER` (`resend` or `brevo`), `EMAIL_API_KEY` and a verified sender address in `EMAIL_FROM`. Invites and reset links require this configuration; delivery status appears in the HR outbox. Emails contain a Reflect heading, action link and plain-text alternative, without review answers.

The app polls its outbox every minute while its process has CPU. Scale-to-zero hosting needs an external timer: configure your scheduler to POST your deployment's `/api/jobs` endpoint every 30 minutes, with `Authorization: Bearer <CRON_SECRET>` (an owner-chosen secret of at least 32 characters) or the generated `SCHEDULER_SECRET`. Store the value in your scheduler's secret facility. No scheduler jobs or provider account are provisioned by this repository. Existing delivery/demo infrastructure is not inherited.

Reminders apply to open draft reviews within seven days of deadline. Submitted reviews, closed/archived cycles and deactivated people stop generating reminders; stale notices are not sent. Resend uses a stable idempotency key. Ambiguous delivery is marked for reconciliation rather than blind resend.

## Administration and recovery

HR imports people using the downloadable CSV template, manages review templates/cycles, calibrates summaries, releases versioned packets and exports JSON/CSV/PDF. Managers approve nominations, write reviews/summaries and track development actions. Employees submit reviews and acknowledge released results. Draft answers remain private to their author; reporting respects current scope and minimum-group policy.

Export a company backup as HR. Restore only into a separate migrated database using `DATABASE_URL=... pnpm exec tsx scripts/restore-export.ts BACKUP.json`. The restore refuses an existing company; password hashes are not exported, so configure email and reset passwords afterward. Private advice is excluded from the HR company export and its restore. Operator-managed database backups include advice and require the same restricted access as the live database. Database provider backup retention and point-in-time recovery belong to the deployment owner. Never test restoration over live data.
