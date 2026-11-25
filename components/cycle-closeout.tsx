'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { closeoutRows } from '@/server/closeout';

type Row = ReturnType<typeof closeoutRows>[number];
type Selection = Pick<Extract<Row, { status: 'ready' }>, 'subjectId' | 'token'>;
const reasons = {
  inactive: 'Participant is inactive',
  cycle_locked: 'Cycle is closed or archived',
  not_due: 'Release date has not arrived',
  summary_missing: 'Manager summary is missing',
  reviews_incomplete: 'Assigned reviews are incomplete',
};
const labels = {
  ready: 'Ready',
  blocked: 'Blocked',
  released: 'Released',
  acknowledged: 'Acknowledged',
};
const order = ['ready', 'blocked', 'released', 'acknowledged'];

export function CycleCloseout({ load, release }: {
  load: () => Promise<Row[]>;
  release: (selection: Selection[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const review = useRef<HTMLButtonElement>(null);
  const message = useRef<HTMLDivElement>(null);
  const focusReview = useRef(false);

  useEffect(() => {
    let active = true;
    load().then(result => { if (active) setRows(result); })
      .catch(() => { if (active) setError('Could not load the closeout queue. Try again.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [load]);
  useEffect(() => {
    if (confirm) confirmation.current?.focus();
    else if (focusReview.current) {
      review.current?.focus();
      focusReview.current = false;
    }
  }, [confirm]);
  useEffect(() => {
    if (error || notice) message.current?.focus();
  }, [error, notice]);

  const ready = (rows ?? []).filter((row): row is Extract<Row, { status: 'ready' }> =>
    row.status === 'ready' && selected.includes(row.subjectId));

  async function refreshQueue() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setRows(await load());
      setNeedsRefresh(false);
      setSelected([]);
      setNotice('Queue refreshed. Review the current status before selecting participants.');
    } catch {
      setError('Could not load the closeout queue. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    setError('');
    try {
      await release(ready.map(({ subjectId, token }) => ({ subjectId, token })));
      setSelected([]);
      setConfirm(false);
      setNotice(`Released ${ready.length} ${ready.length === 1 ? 'packet' : 'packets'}. The cycle stays open.`);
      try {
        setRows(await load());
      } catch {
        setNeedsRefresh(true);
      }
    } catch (cause) {
      setSelected([]);
      setConfirm(false);
      setNeedsRefresh(true);
      setError(cause instanceof Error && cause.message === 'CLOSEOUT_CHANGED'
        ? 'The queue changed. No packets were released in this batch. Refresh the queue before trying again.'
        : 'Release could not be confirmed. Refresh the queue to check the current status.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="space-y-4" aria-busy={busy}>
    {error && <Alert ref={message} tabIndex={-1} variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && <div className="text-sm text-muted-foreground" role="status" ref={message} tabIndex={-1}>{notice}</div>}
    {busy && !rows && <p role="status">Loading closeout queue…</p>}
    {confirm ? <div className="space-y-4">
      <h3 className="font-semibold" ref={confirmation} tabIndex={-1}>Confirm first release</h3>
      <p className="text-sm text-muted-foreground">Each person will receive version 1 of their results. The cycle stays open so they can acknowledge.</p>
      <ul className="list-disc pl-5 space-y-1">{ready.map(row => <li key={row.subjectId}>{row.name}</li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => { focusReview.current = true; setConfirm(false); }}>Back to queue</Button>
        <Button disabled={busy} onClick={publish}>{busy ? 'Releasing…' : 'Confirm release'}</Button>
      </div>
    </div> : <>
      {rows && <ul className="divide-y border-y" aria-label="Participant readiness">
        {[...rows].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)).map(row => (
          <li key={row.subjectId} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0 break-words">
              {row.status === 'ready' ? <label className="flex min-h-6 cursor-pointer items-center gap-2 font-medium">
                <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={selected.includes(row.subjectId)}
                  disabled={busy || needsRefresh || (selected.length >= 100 && !selected.includes(row.subjectId))}
                  onChange={event => setSelected(event.target.checked ? [...selected, row.subjectId] : selected.filter(id => id !== row.subjectId))}/>
                {row.name}
              </label> : <p className="font-medium">{row.name}</p>}
              {row.status === 'blocked' && <p className="text-sm text-muted-foreground">{reasons[row.reason]}</p>}
              {(row.status === 'acknowledged' || row.status === 'released') && <p className="text-sm text-muted-foreground">Version {row.version}</p>}
            </div>
            <Badge variant="outline" className={`status-badge tone-${row.status === 'blocked' ? 'warning' : 'success'}`}>{labels[row.status]}</Badge>
          </li>
        ))}
      </ul>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={refreshQueue}>Refresh queue</Button>
        {rows?.some(row => row.status === 'ready') && <Button ref={review} disabled={busy || needsRefresh || !ready.length}
          onClick={() => { setNotice(''); setConfirm(true); }}>Review release ({ready.length})</Button>}
      </div>
      {selected.length === 100 && <p className="text-sm text-muted-foreground">Release up to 100 packets per batch.</p>}
    </>}
  </div>;
}
