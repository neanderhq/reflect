// Real production image + disposable PostgreSQL; no live deployment/provider access.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import { seedTemplate, DEMO_COMPANY } from './seed-template';

const exec = promisify(execFile);
async function main() {
  const image = process.env.NEANDER_TEMPLATE_IMAGE;
  const databaseUrl = process.env.NEANDER_TEMPLATE_TEST_DATABASE_URL;
  const password = process.env.DEMO_PASSWORD;
  assert.ok(image && databaseUrl && password, 'Use the shared verifier with a disposable PostgreSQL database');
  assert.equal(process.env.DATABASE_URL, databaseUrl);
  const origin = new URL(process.env.APP_ORIGIN!);
  assert.ok(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname));
  const name = `reflect-check-${randomUUID().slice(0, 12)}`;
  const directory = await mkdtemp(join(tmpdir(), 'reflect-check-'));
  const bundle = join(directory, 'neander_environment');
  const runtimeDatabase = new URL(databaseUrl);
  if (process.platform === 'darwin' && ['127.0.0.1', 'localhost'].includes(runtimeDatabase.hostname)) runtimeDatabase.hostname = 'host.docker.internal';
  const environment = { DATABASE_URL: runtimeDatabase.href, APP_ORIGIN: origin.origin,
    AUTH_TOKEN_KEY: process.env.AUTH_TOKEN_KEY!, HR_SETUP_KEY: process.env.HR_SETUP_KEY!,
    SCHEDULER_SECRET: process.env.SCHEDULER_SECRET!, DEMO_PASSWORD: password };
  await writeFile(bundle, Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o644 });
  let browser;
  async function ready() {
    for (let attempt = 0; attempt < 120; attempt++) {
      try { const response = await fetch(`${origin.origin}/api/health`); const data = await response.json();
        if (response.ok && Object.values(data.runtime).every(Boolean)) return; } catch {}
      await delay(500);
    }
    throw new Error('Production image did not become ready');
  }
  try {
    const networking = process.platform === 'linux' ? ['--network', 'host', '--env', `PORT=${origin.port || 80}`] : ['--publish', `127.0.0.1:${origin.port || 80}:8080`];
    await exec('docker', ['run', '--detach', '--name', name, '--mount', `type=bind,src=${bundle},dst=/run/secrets/neander_environment,readonly`, ...networking, image], { timeout: 60000 });
    await ready();
    assert.deepEqual(await seedTemplate(), { created: false });
    await exec('pnpm', ['exec', 'playwright', 'install', ...(process.platform === 'linux' ? ['--with-deps'] : []), 'chromium'], { timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${origin.origin}/login`);
    await expect(page).toHaveTitle(/Reflect/);
    await page.getByLabel('Workspace ID').fill(DEMO_COMPANY);
    await page.getByLabel('Email', { exact: true }).fill('hr@reflect.test');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    const snapshot = async () => {
      const response = await context.request.get(`${origin.origin}/api/workspace`);
      assert.equal(response.status(), 200, await response.text());
      return response.json();
    };
    const before = await snapshot();
    assert.equal(before.people.length, 6);
    assert.equal(before.cycles.length, 2);
    assert.ok(before.assignments.length > 0 && before.packets.length > 0);
    assert.equal(before.me.role, 'hr_admin');
    const capture = process.env.REFLECT_CAPTURE_DIRECTORY;
    if (capture) { await mkdir(join(capture, 'screenshots'), { recursive: true }); await page.screenshot({ path: join(capture, 'thumbnail.png') }); }
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'People', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'People', exact: true })).toBeVisible();
    if (capture) await page.screenshot({ path: join(capture, 'screenshots/people.png') });
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^My Reviews/ }).click();
    await expect(page.getByRole('heading', { name: 'Reviews', exact: true })).toBeVisible();
    if (capture) await page.screenshot({ path: join(capture, 'screenshots/reviews.png') });
    const action = before.actions[0];
    const title = `Template persistence ${randomUUID().slice(0, 8)}`;
    const response = await context.request.post(`${origin.origin}/api/workspace`, { headers: { origin: origin.origin, 'X-Lattice-Request': '1' }, data: { command: 'action', ...action, title } });
    assert.equal(response.status(), 200, await response.text());
    assert.deepEqual(await seedTemplate(), { created: false });
    await exec('docker', ['restart', name], { timeout: 60000 });
    await ready();
    const after = await snapshot();
    assert.equal(after.actions.find((item: { id: string }) => item.id === action.id).title, title);
    assert.equal(after.people.length, before.people.length);
    const anonymous = await fetch(`${origin.origin}/api/workspace`);
    assert.equal(anonymous.status, 401);
    for (const [email, role] of [['manager@reflect.test', 'manager'], ['alex@reflect.test', 'employee']]) {
      const isolated = await browser.newContext();
      const login = await isolated.request.post(`${origin.origin}/api/auth/login`, { headers: { origin: origin.origin, 'X-Lattice-Request': '1' }, data: { company: DEMO_COMPANY, email, password } });
      assert.equal(login.status(), 200, await login.text());
      const data = await (await isolated.request.get(`${origin.origin}/api/workspace`)).json();
      assert.equal(data.me.role, role);
      const backup = await isolated.request.get(`${origin.origin}/api/backup`);
      assert.equal(backup.status(), 403);
      await isolated.close();
    }
    console.log('PASS: production image, fictional data, HR UI, role-scoped access, retry-preserving seed and edit persistence after restart');
  } finally {
    await browser?.close();
    try { await exec('docker', ['rm', '--force', name], { timeout: 30000 }); } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
