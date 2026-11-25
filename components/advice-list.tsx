'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { adviceFor } from '@/server/advice';

export type Advice = ReturnType<typeof adviceFor>[number];

const states = {
  pending: { label: 'Pending', tone: 'warning' },
  answered: { label: 'Answered', tone: 'success' },
  canceled: { label: 'Canceled', tone: 'muted' },
  declined: { label: 'Declined', tone: 'muted' },
};

export function AdviceList({ requests, onReply, onResolve, dateLabel }: {
  requests: Advice[];
  onReply: (request: Advice) => void;
  onResolve: (request: Advice, action: 'cancel' | 'decline') => void;
  dateLabel: (date: string) => string;
}) {
  return <div className="space-y-4">{requests.map(request => {
    const { label, tone } = states[request.status];
    return <Card key={request.id}>
      <CardHeader className="section-heading">
        <div className="min-w-0 break-words">
          <CardTitle>{request.incoming ? 'From' : 'To'} {request.colleague}</CardTitle>
          <CardDescription>{dateLabel(request.createdAt)}</CardDescription>
        </div>
        <Badge variant="outline" className={`status-badge tone-${tone}`}>{label}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-medium">Question</h3>
          <p className="whitespace-pre-wrap break-words">{request.question}</p>
        </div>
        {request.status === 'answered' && <div className="border-l-2 border-primary/25 pl-4">
          <h3 className="font-medium">Reply</h3>
          <p className="whitespace-pre-wrap break-words">{request.reply}</p>
        </div>}
        {request.status !== 'pending' && <p className="text-sm text-muted-foreground">{label} {dateLabel(request.resolvedAt)}</p>}
        {request.status === 'pending' && <div className="flex flex-wrap gap-2">
          {request.incoming && <Button onClick={() => onReply(request)}>Reply</Button>}
          {request.incoming
            ? <Button variant="outline" onClick={() => onResolve(request, 'decline')}>Decline</Button>
            : <Button variant="outline" onClick={() => onResolve(request, 'cancel')}>Cancel request</Button>}
        </div>}
      </CardContent>
    </Card>;
  })}</div>;
}
