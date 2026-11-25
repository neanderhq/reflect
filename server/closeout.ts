import { createHash } from 'node:crypto';
import type { Cycle, State } from './model';

type BlockReason = 'inactive' | 'cycle_locked' | 'not_due' | 'summary_missing' | 'reviews_incomplete';
type Row = { subjectId: string; name: string } & (
  | { status: 'ready'; token: string }
  | { status: 'blocked'; reason: BlockReason }
  | { status: 'released' | 'acknowledged'; version: number }
);

export function closeoutRows(state: State, cycle: Cycle, now: number): Row[] {
  const people = new Map(state.people.map(person => [person.id, person]));
  const latest = new Map<string, State['packets'][number]>();
  for (const packet of state.packets) {
    if (packet.cycleId === cycle.id && packet.version > (latest.get(packet.subjectId)?.version ?? 0)) {
      latest.set(packet.subjectId, packet);
    }
  }
  const acknowledged = new Set(state.acknowledgments.map(row => row.packetId));
  const summaries = new Map(state.summaries.filter(row => row.cycleId === cycle.id).map(row => [row.subjectId, row]));
  const assignments = new Map<string, State['assignments']>();
  for (const assignment of state.assignments) {
    if (assignment.cycleId !== cycle.id) continue;
    const rows = assignments.get(assignment.subjectId) ?? [];
    rows.push(assignment);
    assignments.set(assignment.subjectId, rows);
  }

  return cycle.roster.map(({ id: subjectId, name }) => {
    const subject = { subjectId, name };
    const packet = latest.get(subjectId);
    if (packet) return { ...subject, status: acknowledged.has(packet.id) ? 'acknowledged' : 'released', version: packet.version };

    const block = (reason: BlockReason): Row => ({ ...subject, status: 'blocked', reason });
    const person = people.get(subjectId);
    if (!person?.active) return block('inactive');
    if (cycle.status !== 'open') return block('cycle_locked');
    if (now < Date.parse(cycle.releaseDate)) return block('not_due');
    const summary = summaries.get(subjectId);
    if (!summary) return block('summary_missing');
    const reviews = assignments.get(subjectId) ?? [];
    if (reviews.some(assignment => assignment.status !== 'submitted')) return block('reviews_incomplete');

    const versions = reviews.map(assignment => [
      assignment.id, assignment.revision,
      cycle.policy[assignment.type].disclose ? people.get(assignment.authorId)?.name : null,
    ] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    const token = createHash('sha256').update(JSON.stringify([
      cycle.id, cycle.revision, subjectId, person.authVersion, summary.id, summary.revision, versions,
    ])).digest('hex');
    return { ...subject, status: 'ready', token };
  });
}
