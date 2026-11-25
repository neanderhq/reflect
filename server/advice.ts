import { type Person, type State, requireThat, text } from './model';

const sentence = (value: unknown) => {
  const content = text(value, 2000);
  requireThat(content, 'ADVICE_TEXT_REQUIRED');
  return content;
};

export function sendAdvice(state: State, actor: Person, input: Record<string, unknown>) {
  const requestId = text(input.requestId, 36);
  requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId));
  const address = text(input.recipientEmail, 254).toLowerCase();
  const question = sentence(input.question);
  const recipient = state.people.find(person => person.email === address);
  const existing = state.adviceRequests.find(request => request.id === requestId);
  if (existing) {
    requireThat(existing.requesterId === actor.id && existing.recipientId === recipient?.id &&
      existing.question === question, 'ADVICE_REQUEST_CONFLICT', 409);
    return { id: requestId };
  }
  requireThat(recipient?.active && recipient.id !== actor.id, 'ADVICE_RECIPIENT_UNAVAILABLE');
  state.adviceRequests.push({
    id: requestId, requesterId: actor.id, recipientId: recipient.id, question,
    createdAt: new Date().toISOString(), status: 'pending',
  });
  return { id: requestId };
}

export function resolveAdvice(state: State, actor: Person, input: Record<string, unknown>,
  status: 'answered' | 'canceled' | 'declined') {
  const index = state.adviceRequests.findIndex(request => request.id === input.id &&
    (request.requesterId === actor.id || request.recipientId === actor.id));
  const request = state.adviceRequests[index];
  requireThat(request, 'NOT_FOUND', 404);
  requireThat(actor.id === (status === 'canceled' ? request.requesterId : request.recipientId), 'FORBIDDEN', 403);
  const reply = status === 'answered' ? sentence(input.reply) : '';
  if (request.status === status && (request.status !== 'answered' || request.reply === reply)) {
    return { id: request.id };
  }
  requireThat(request.status === 'pending', 'ADVICE_CLOSED', 409);
  const next = { ...request, resolvedAt: new Date().toISOString() };
  state.adviceRequests[index] = status === 'answered' ? { ...next, status, reply } : { ...next, status };
  return { id: request.id };
}

export function adviceFor(state: State, actor: Person) {
  return state.adviceRequests.filter(request => request.requesterId === actor.id || request.recipientId === actor.id)
    .map(request => {
      const incoming = request.recipientId === actor.id;
      const otherId = incoming ? request.requesterId : request.recipientId;
      return {
        ...request, incoming,
        colleague: state.people.find(person => person.id === otherId)?.name ?? 'Former colleague',
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}
