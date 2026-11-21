# Verification status

This repository was extracted from Ibrahim's delivered Reflect application. Functional acceptance of that delivery is separate from template verification. The application tests cover roles, privacy, revision conflicts, cycles, reviews, reports, email rendering and backup/restore using disposable PostgreSQL-compatible fixtures and mocked delivery.

The Neander template release workflow additionally builds the production image, applies committed migrations to disposable PostgreSQL, seeds fictional data and verifies the running image, including persistence across restart. A successful published release is the registration proof. Provider email delivery, external scheduler ownership and managed database recovery must be verified for each deployment separately.
