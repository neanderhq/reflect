import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { loadState, persistState, setTestDb, type Database } from '../server/db';
import { emptyState, type Person } from '../server/model';
import { type workspace } from '../server/policy';
import * as schema from '../server/schema';
import { actorFromToken, newSession } from '../server/session';
import { operation } from '../server/service';
import { syntheticState } from '../server/synthetic';

const company = 'feature-workflows';
const foreignCompany = 'feature-isolation';
let fixtureDb: Database;
async function command<T = unknown>(personId: string, name: string, input: Record<string, unknown> = {}, companyId = company) {
  const person = (await loadState(fixtureDb, companyId)).people.find(p => p.id === personId)!;
  const token = await newSession(fixtureDb, { companyId, personId }, person.authVersion);
  return operation(await actorFromToken(token), name, input) as Promise<T>;
}
const read = (personId: string, companyId = company) => command<ReturnType<typeof workspace>>(personId, 'workspace', {}, companyId);

async function fixture(run: (db: Database) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'reflect-features-'));
  const client = new PGlite(directory);
  const embedded = drizzle(client, { schema });
  const db = embedded as unknown as Database;
  try {
    await migrate(embedded, { migrationsFolder: 'drizzle' });
    fixtureDb = db;
    setTestDb(db);
    for (const tenant of [company, foreignCompany]) {
      await db.insert(schema.companies).values({ id: tenant, name: tenant });
      const state = syntheticState('not-a-login-password');
      for (const person of state.people) person.email = `${person.id}@${tenant}.test`;
      state.notices = [];
      await persistState(db, tenant, emptyState(), state);
    }
    await run(db);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function updatePerson(person: Person, change: Partial<Pick<Person, 'role' | 'managerId' | 'active'>>) {
  return command('hr', 'person.update', { ...person, revision: person.revision ?? 0, ...change });
}

test('goals link a released version, persist with actions and follow current manager access', async () => {
  await fixture(async db => {
    const before = await loadState(db, company);
    const packetId = before.packets[0].id;
    const input = {
      packetId, title: 'Clearer check-ins', successMeasure: 'Run two project check-ins',
      actionTitle: 'Prepare an agenda', ownerId: 'alex', due: '2027-01-10',
    };
    await assert.rejects(command('blair', 'goal.save', input), /NOT_FOUND/);
    await assert.rejects(command('hr', 'goal.save', input), /FORBIDDEN/);
    await assert.rejects(command('alex', 'goal.save', input, foreignCompany), /NOT_FOUND/);
    await assert.rejects(command('alex', 'goal.save', { ...input, due: '2027-02-30' }), /INVALID_DATE/);
    await assert.rejects(command('alex', 'goal.save', { ...input, ownerId: 'blair' }), /INVALID_OWNER/);
    assert.equal((await read('alex')).goals.length, 0);
    assert.equal((await read('alex')).actions.length, 1);

    const { id } = await command<{ id: string }>('alex', 'goal.save', input);
    await assert.rejects(command('manager', 'goal.save', input), /GOAL_EXISTS/);
    const owner = await read('alex');
    const action = owner.actions.find(a => a.goalId === id)!;
    assert.equal(action.title, input.actionTitle);
    assert.equal(owner.goals[0].source?.id, packetId);
    assert.equal((await read('hr')).goals[0].canEdit, false);
    await assert.rejects(command('hr', 'action', { ...action, progress: 'complete' }), /FORBIDDEN/);
    await command('manager', 'goal.save', { id, revision: 0, title: input.title, successMeasure: 'Run three check-ins' });
    await assert.rejects(command('alex', 'goal.save', { id, revision: 0, ...input }), /REVISION_CONFLICT/);
    await command('manager', 'action', { ...action, progress: 'complete' });
    await assert.rejects(command('alex', 'action', { ...action, progress: 'in_progress' }), /REVISION_CONFLICT/);
    assert.equal((await read('alex')).actions.find(a => a.id === action.id)?.progress, 'complete');
    assert.equal((await read('alex')).goals[0].successMeasure, 'Run three check-ins');
    assert.equal((await read('blair')).goals.length, 0);

    await updatePerson(before.people.find(p => p.id === 'casey')!, { role: 'manager' });
    await updatePerson(before.people.find(p => p.id === 'alex')!, { managerId: 'casey' });
    const transferred = await read('casey');
    assert.equal(transferred.goals[0].source, null);
    assert.equal(transferred.goals[0].canEdit, true);
    assert.ok(!JSON.stringify(transferred.goals).includes(packetId));
    assert.equal((await read('manager')).goals.length, 0);
    await assert.rejects(command('manager', 'goal.save', { ...input, id, revision: 1 }), /NOT_FOUND/);
    await command('casey', 'goal.save', { ...input, id, revision: 1, successMeasure: 'Run four check-ins' });
    assert.equal((await read('alex')).goals[0].successMeasure, 'Run four check-ins');
    assert.deepEqual((await loadState(db, company)).packets, before.packets);
  });
});
