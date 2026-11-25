import { pgTable, text, jsonb, primaryKey, timestamp, integer, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Person, Template, Cycle, Assignment, Nomination, Summary, Packet, Acknowledgment, DevelopmentAction, DevelopmentGoal, AdviceRequest, Audit, Notice } from './model';
export const companies = pgTable('companies', { id: text('id').primaryKey(), name: text('name').notNull() });
const entity = <T>(name: string) => pgTable(name, { companyId: text('company_id').notNull().references(()=>companies.id), id: text('id').notNull(), data: jsonb('data').$type<T>().notNull() }, t=>[primaryKey({columns:[t.companyId,t.id]})]);
export const people = entity<Person>('people');
export const templates = entity<Template>('templates');
export const cycles = entity<Cycle>('cycles');
export const assignments = pgTable('assignments', { companyId:text('company_id').notNull().references(()=>companies.id), id:text('id').notNull(), data:jsonb('data').$type<Assignment>().notNull() }, t=>[
  primaryKey({columns:[t.companyId,t.id]}),
  uniqueIndex('assignments_identity_unique').on(t.companyId,sql`(${t.data}->>'cycleId')`,sql`(${t.data}->>'type')`,sql`(${t.data}->>'authorId')`,sql`(${t.data}->>'subjectId')`),
  check('assignments_opaque_id',sql`${t.id} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND ${t.data}->>'id' = ${t.id}`),
]);
export const nominations = entity<Nomination>('nominations');
export const summaries = entity<Summary>('summaries');
export const packets = entity<Packet>('packets');
export const acknowledgments = entity<Acknowledgment>('acknowledgments');
export const goals = entity<DevelopmentGoal>('development_goals');
export const actions = entity<DevelopmentAction>('development_actions');
export const adviceRequests = entity<AdviceRequest>('advice_requests');
export const audits = entity<Audit>('audit_events');
export const notices = entity<Notice>('notification_outbox');
export const sessions = pgTable('sessions', { hash: text('hash').primaryKey(), companyId: text('company_id').notNull().references(()=>companies.id), personId: text('person_id').notNull(), version: integer('version').notNull(), expires: timestamp('expires',{withTimezone:true}).notNull() }, t=>[index('sessions_expiry').on(t.expires)]);
export const tokens = pgTable('auth_tokens', { hash: text('hash').primaryKey(), companyId: text('company_id').notNull().references(()=>companies.id), personId: text('person_id').notNull(), kind: text('kind').notNull(), sealed: text('sealed').notNull(), expires: timestamp('expires',{withTimezone:true}).notNull() });
export const throttles = pgTable('auth_throttles', { key: text('key').primaryKey(), count: integer('count').notNull(), expires: timestamp('expires',{withTimezone:true}).notNull() });
export const tables = { people, templates, cycles, assignments, nominations, summaries, packets, acknowledgments, goals, actions, adviceRequests, audits, notices };
