import { cp, rm, readdir } from "node:fs/promises";
await cp("public", ".next/standalone/public", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });

// Instrumentation tracing can include runtime-relative local folders even when
// route tracing excludes them. Remove only generated copies, never source data.
for (const name of await readdir(".next/standalone")) {
  if (name === ".pglite" || name === ".test-data" || name === ".env" || name.startsWith(".env.")) {
    await rm(`.next/standalone/${name}`, { recursive: true, force: true });
  }
}
