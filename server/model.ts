export type Role = 'hr_admin' | 'manager' | 'employee';
export type ReviewType = 'self' | 'manager' | 'upward' | 'peer';
export const reviewTypes: ReviewType[] = ['self', 'manager', 'upward', 'peer'];
export interface Entity { id: string }
export interface Person extends Entity { email: string; name: string; team: string; title: string; managerId: string | null; role: Role; active: boolean; passwordHash: string; authVersion: number; revision?: number }
export interface Question { id: string; text: string; kind: 'written' | 'rating'; required: boolean }
export interface Template extends Entity { name: string; version: number; family: string; role: Role | 'all'; type: ReviewType; questions: Question[] }
export interface Snapshot { id: string; name: string; team: string; managerId: string | null; role: Role }
export interface Policy { include: boolean; disclose: boolean }
export interface Cycle extends Entity { name: string; status: 'open' | 'closed' | 'archived'; previousStatus?: 'open' | 'closed'; start: string; nominationDue: string; reviewDue: string; releaseDate: string; roster: Snapshot[]; templates: Template[]; policy: Record<ReviewType, Policy>; minGroup?: number; revision: number }
export interface Assignment extends Entity { cycleId: string; type: ReviewType; authorId: string; subjectId: string; questions: Question[]; answers: Record<string, string | number>; status: 'draft' | 'submitted'; revision: number; submittedAt?: string }
export interface Nomination extends Entity { cycleId: string; subjectId: string; authorId: string; status: 'pending' | 'approved' | 'rejected' }
export interface Summary extends Entity { cycleId: string; subjectId: string; text: string; originalRating: number; rating: number; calibrationReason: string; revision: number }
export interface Feedback { type: ReviewType; authorName?: string; answers: { question: string; value: string | number }[] }
export interface Packet extends Entity { cycleId: string; subjectId: string; version: number; releasedAt: string; summary: string; originalRating: number; rating: number; calibrationReason: string; feedback: Feedback[] }
export interface Acknowledgment extends Entity { packetId: string; subjectId: string; at: string }
export interface DevelopmentGoal extends Entity { subjectId: string; packetId: string; title: string; successMeasure: string; revision: number }
export interface DevelopmentAction extends Entity { goalId?: string; subjectId: string; ownerId: string; title: string; notes: string; due: string; progress: 'planned' | 'in_progress' | 'complete'; revision: number }
export interface Audit extends Entity { actorId: string; action: string; targetId: string; at: string; reason?: string; before?: unknown; after?: unknown }
export interface Notice extends Entity { recipientId: string; kind: 'assignment' | 'reminder' | 'release' | 'invite' | 'reset'; key: string; cycleId?: string; assignmentId?: string; due?: string; href: string; status: 'pending' | 'claimed' | 'disabled' | 'sent' | 'stale' | 'failed'; attempts: number; nextAttempt: string; claim?: string; claimedAt?: string; diagnostic?: string; read: boolean }
export interface State { people: Person[]; templates: Template[]; cycles: Cycle[]; assignments: Assignment[]; nominations: Nomination[]; summaries: Summary[]; packets: Packet[]; acknowledgments: Acknowledgment[]; goals: DevelopmentGoal[]; actions: DevelopmentAction[]; audits: Audit[]; notices: Notice[] }
export const collections = ['people','templates','cycles','assignments','nominations','summaries','packets','acknowledgments','goals','actions','audits','notices'] as const;
export const emptyState = (): State => Object.fromEntries(collections.map(k=>[k,[]])) as unknown as State;
export interface Actor { companyId: string; personId: string; sessionHash?: string; version?: number }
export class AppError extends Error { constructor(public code: string, public status = 400, public details?: unknown) { super(code); } }
export function requireThat(value: unknown, code = 'INVALID_INPUT', status = 400): asserts value { if (!value) throw new AppError(code, status); }
export const text = (value: unknown, max = 500): string => { requireThat(typeof value === 'string' && value.length <= max); return value.trim(); };
export const id = (value: unknown) => { const v = text(value, 100); requireThat(/^[a-zA-Z0-9_-]+$/.test(v)); return v; };
export const email = (value: unknown) => { const v = text(value, 254).toLowerCase(); requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'INVALID_EMAIL'); return v; };
