import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildExport, restoreExport } from '../server/backup';
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

test('closeout first releases are HR-only, revision-bound and all-or-nothing', async () => {
  await fixture(async db => {
    const cycleId = 'spring-history';
    const queue = (personId = 'hr', id = cycleId) =>
      command<ReturnType<typeof import('../server/closeout').closeoutRows>>(personId, 'cycle.closeout', { cycleId: id });
    const summary = (subjectId: string) => command<{ id: string; revision: number }>('hr', 'summary', {
      cycleId, subjectId, text: 'Consistent work on fictional projects.', revision: 0, rating: 3,
    });
    const blair = await summary('blair');
    await summary('casey');
    await summary('drew');
    const initial = await loadState(db, company);
    const alexPacket = initial.packets[0];
    await command('alex', 'acknowledge', { id: alexPacket.id });
    const drewReview = initial.assignments.find(a => a.cycleId === cycleId && a.subjectId === 'drew')!;
    await command('hr', 'review.reopen', { id: drewReview.id, revision: drewReview.revision, reason: 'Add evidence' });

    await assert.rejects(queue('manager'), /FORBIDDEN/);
    assert.ok((await queue('hr', 'autumn-growth')).every(row => row.status === 'blocked' && row.reason === 'not_due'));
    const before = await queue();
    assert.equal(before.find(row => row.subjectId === 'alex')?.status, 'acknowledged');
    assert.deepEqual(before.find(row => row.subjectId === 'drew'), {
      subjectId: 'drew', name: 'Drew Silva', status: 'blocked', reason: 'reviews_incomplete',
    });
    assert.ok(before.some(row => row.status === 'blocked' && row.reason === 'summary_missing'));
    const selection = before.flatMap(row => row.status === 'ready' ? [{ subjectId: row.subjectId, token: row.token }] : []);
    assert.deepEqual(selection.map(row => row.subjectId), ['blair', 'casey']);
    const batch = (rows = selection, tenant = company, person = 'hr') =>
      command<{ released: string[] }>(person, 'release.batch', { cycleId, selection: rows }, tenant);
    await assert.rejects(batch([], company, 'alex'), /FORBIDDEN/);
    await assert.rejects(batch([]), /INVALID_CLOSEOUT_SELECTION/);
    await assert.rejects(batch([selection[0], selection[0]]), /INVALID_CLOSEOUT_SELECTION/);
    await assert.rejects(batch(selection, foreignCompany), /CLOSEOUT_CHANGED/);
    await command('hr', 'calibrate', { ...blair, rating: 4, reason: 'Compare project scope' });
    await assert.rejects(batch(), /CLOSEOUT_CHANGED/);
    assert.deepEqual((await loadState(db, company)).packets, initial.packets);
    assert.equal((await loadState(db, company)).notices.length, 0);

    const current = (await queue()).flatMap(row => row.status === 'ready' ? [{ subjectId: row.subjectId, token: row.token }] : []);
    const writes = await Promise.allSettled([batch(current), batch(current)]);
    const completed = writes.find(result => result.status === 'fulfilled');
    const rejected = writes.find(result => result.status === 'rejected');
    assert.equal(completed?.value.released.length, 2);
    assert.match(String(rejected?.reason), /CLOSEOUT_CHANGED/);
    const after = await loadState(db, company);
    assert.equal(after.cycles.find(c => c.id === cycleId)?.status, 'open');
    assert.equal(after.packets.length, 3);
    assert.equal(after.notices.filter(n => n.kind === 'release').length, 2);
    assert.equal(after.audits.filter(a => a.action === 'packet.released').length, 2);
    assert.equal((await read('casey')).packets.find(p => p.cycleId === cycleId)?.version, 1);

    const updatedSummary = after.summaries.find(s => s.cycleId === cycleId && s.subjectId === 'blair')!;
    const version2 = await command<{ id: string; version: number }>('hr', 'release', {
      cycleId, subjectId: 'blair', revision: updatedSummary.revision, expectedVersion: 1,
    });
    assert.equal(version2.version, 2);
    assert.equal((await queue()).find(row => row.subjectId === 'blair')?.status, 'released');
    await command('blair', 'acknowledge', { id: version2.id });
    assert.equal((await queue()).find(row => row.subjectId === 'blair')?.status, 'acknowledged');
    await command('hr', 'cycle.status', { id: cycleId, revision: 0, status: 'closed', reason: 'Close after releases' });
    await assert.rejects(command('casey', 'acknowledge', { id: after.packets.find(p => p.subjectId === 'casey')!.id }), /CYCLE_LOCKED/);
  });
});

test('advice is participant-only, durable across terminal transitions and omitted from HR recovery', async () => {
  await fixture(async db => {
    const input = {
      requestId: randomUUID(),
      recipientEmail: ` BLAIR@${company.toUpperCase()}.TEST `,
      question: 'How can I make sprint updates clearer?',
    };
    const send = (values = input) => command<{ id: string }>('alex', 'advice.send', values);
    const privateReply = 'Start with one decision and what you need from the team.';
    const before = await loadState(db, company);
    await updatePerson(before.people.find(p => p.id === 'drew')!, { active: false });
    for (const recipientEmail of [`alex@${company}.test`, `blair@${foreignCompany}.test`, `drew@${company}.test`, 'unknown']) {
      await assert.rejects(send({ ...input, recipientEmail }), /ADVICE_RECIPIENT_UNAVAILABLE/);
    }
    await assert.rejects(send({ ...input, question: '  ' }), /ADVICE_TEXT_REQUIRED/);
    const duplicates = await Promise.all([send(), send()]);
    assert.deepEqual(duplicates, [{ id: input.requestId }, { id: input.requestId }]);
    await assert.rejects(send({ ...input, question: 'Different content' }), /ADVICE_REQUEST_CONFLICT/);
    assert.equal((await read('alex')).advice[0].incoming, false);
    const received = (await read('blair')).advice[0];
    assert.equal(received.incoming, true);
    assert.equal(received.colleague, 'Alex Chen');
    assert.equal(received.status, 'pending');

    for (const outsider of ['hr', 'manager', 'casey']) {
      assert.equal((await read(outsider)).advice.length, 0);
      await assert.rejects(command(outsider, 'advice.reply', { id: input.requestId, reply: privateReply }), /NOT_FOUND/);
    }
    assert.equal((await read('blair', foreignCompany)).advice.length, 0);
    await assert.rejects(command('blair', 'advice.reply', { id: input.requestId, reply: privateReply }, foreignCompany), /NOT_FOUND/);
    await assert.rejects(command('alex', 'advice.reply', { id: input.requestId, reply: privateReply }), /FORBIDDEN/);
    await assert.rejects(command('blair', 'advice.cancel', { id: input.requestId }), /FORBIDDEN/);
    await assert.rejects(command('blair', 'advice.reply', { id: input.requestId, reply: ' ' }), /ADVICE_TEXT_REQUIRED/);
    const reply = (text: string) => command('blair', 'advice.reply', { id: input.requestId, reply: text });
    await reply(privateReply);
    const answered = (await read('alex')).advice[0];
    assert.ok(answered.status === 'answered' && answered.reply === privateReply && answered.resolvedAt);
    await reply(privateReply);
    assert.deepEqual((await read('alex')).advice[0], answered);
    await assert.rejects(reply('Try a different format'), /ADVICE_CLOSED/);
    await assert.rejects(command('alex', 'advice.cancel', { id: input.requestId }), /ADVICE_CLOSED/);

    for (const [action, actor, status] of [['cancel', 'alex', 'canceled'], ['decline', 'blair', 'declined']]) {
      const { id } = await send({ ...input, requestId: randomUUID(), question: `An example to ${action}` });
      await command(actor, `advice.${action}`, { id });
      await command(actor, `advice.${action}`, { id });
      assert.equal((await read('alex')).advice.find(r => r.id === id)?.status, status);
      assert.equal((await read('blair')).advice.find(r => r.id === id)?.status, status);
      await assert.rejects(command('blair', 'advice.reply', { id, reply: privateReply }), /ADVICE_CLOSED/);
    }

    const after = await loadState(db, company);
    assert.equal(after.adviceRequests.length, 3);
    assert.deepEqual(after.notices, before.notices);
    assert.deepEqual(after.packets, before.packets);
    assert.ok(!JSON.stringify(after.audits).includes(input.requestId));
    assert.ok(!JSON.stringify(await read('hr')).includes(privateReply));
    const backup = buildExport(after, { id: 'feature-recovery', name: 'Feature recovery' });
    assert.ok(!('adviceRequests' in backup.data));
    assert.ok(!('adviceRequests' in backup.counts));
    assert.ok(!JSON.stringify(backup).includes(privateReply));
    await restoreExport(db, { ...backup, data: { ...backup.data, adviceRequests: after.adviceRequests } });
    assert.equal((await loadState(db, 'feature-recovery')).adviceRequests.length, 0);
    assert.ok((await loadState(db, 'feature-recovery')).packets.length > 0);
  });
});
