'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { reviewTypes, type Assignment, type Cycle, type Template } from '@/server/model';
import type { DevelopmentAction } from '@/server/model';
import type { workspace } from '@/server/policy';

type Values = Record<string, unknown>;
type Save = (value: Values) => Promise<void>;
const ratingScale = [1, 2, 3, 4, 5];
const roles = ['all', 'hr_admin', 'manager', 'employee'];

function useSave() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) {
    setPending(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    } finally {
      setPending(false);
    }
  }
  return { pending, error, run };
}

const formErrors: Record<string, string> = {
  REVISION_CONFLICT: 'Someone changed this record. Your input is preserved. Compare the latest version before retrying.',
  TEMPLATE_MISSING: 'Select a template version for every review type (self, manager, upward and peer) that applies to each participant\'s role. Create the missing templates in the Question library first.',
  DEADLINE_ORDER: 'Use ordered dates: start, nomination deadline, review deadline, release date.',
  REQUIRED_ANSWER: 'Please answer each required question.',
  CYCLE_LOCKED: 'This cycle is closed or archived. HR must reopen it before changes can be made.',
  PHASE_NOT_STARTED: 'This phase has not started. Check the cycle dates.',
  PHASE_DEADLINE_PASSED: 'This phase has ended. HR can extend its deadline while the cycle is open.',
  INVALID_MIN_GROUP: 'Choose a minimum group size from 3 to 100.',
  INVALID_OWNER: 'Choose an owner permitted for this employee.',
};
function ErrorMessage({ text }: { text: string }) {
  return text ? <p role="alert">{formErrors[text] || (text.charAt(0) + text.slice(1).toLowerCase()).replaceAll('_', ' ') + '.'}</p> : null;
}

export function ReviewEditor({ assignment, locked, save }: {
  assignment: Assignment;
  locked: boolean;
  save: (answers: Assignment['answers'], submit: boolean) => Promise<void>;
}) {
  const state = useSave();
  const [answers, setAnswers] = useState(assignment.answers);
  const [invalidQuestions, setInvalidQuestions] = useState<string[]>([]);
  const errorPrefix = useId();

  function updateAnswer(id: string, value: string | number) {
    setAnswers(current => ({ ...current, [id]: value }));
    if (String(value).trim()) {
      setInvalidQuestions(current => current.filter(questionId => questionId !== id));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || state.pending) return;
    const missing = assignment.questions.filter(question =>
      question.required && !String(answers[question.id] ?? '').trim(),
    );
    setInvalidQuestions(missing.map(question => question.id));
    if (missing.length) {
      const field = event.currentTarget.elements.namedItem(missing[0].id);
      if (field instanceof HTMLElement) field.focus();
      return;
    }
    void state.run(() => save(answers, true));
  }

  return <form className="form-stack" method="post" onSubmit={submit}>
    {locked&&<p role="status">Editing is locked. Reviews must be within the cycle dates and open for submission. HR can reopen a submitted review.</p>}
    {assignment.questions.map(question => {
      const invalid = invalidQuestions.includes(question.id);
      const errorId = `${errorPrefix}-${question.id}`;
      const field = {
        id: question.id,
        disabled: locked,
        value: answers[question.id] ?? '',
        'aria-required': question.required || undefined,
        'aria-invalid': invalid || undefined,
        'aria-describedby': invalid ? errorId : undefined,
      };
      return <div className="form-field" key={question.id}>
        <Label htmlFor={question.id}>{question.text} {question.required && '(required)'}</Label>
        {question.kind === 'written'
          ? <Textarea {...field} rows={4} onChange={event => updateAnswer(question.id, event.target.value)}/>
          : <select {...field} className="native-select"
            onChange={event => updateAnswer(question.id, event.target.value ? Number(event.target.value) : '')}>
          <option value="">Select a rating</option>
          {ratingScale.map(rating => <option value={rating} key={rating}>{rating} / 5</option>)}
          </select>}
        {invalid && <p id={errorId} role="alert">
          {question.kind === 'rating' ? 'Select a rating for this question.' : 'Enter an answer to this question.'}
        </p>}
      </div>;
    })}
    <ErrorMessage text={state.error}/>
    {!locked && <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={state.pending} onClick={() => {
        setInvalidQuestions([]);
        void state.run(() => save(answers, false));
      }}>Save draft</Button>
      <Button type="submit" disabled={state.pending}>Submit review</Button>
    </div>}
  </form>;
}

export function ImportPeople({ preview, apply }: {
  preview: (csv: string) => Promise<{ errors: { row: number; message: string }[]; rows: unknown[]; directoryVersion:string }>;
  apply: (csv: string, directoryVersion:string) => Promise<void>;
}) {
  const state = useSave();
  const [csv, updateCsv] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof preview>>>();
  const update = (value: string) => { updateCsv(value); setResult(undefined); };
  return <div className="form-stack">
    <Button asChild variant="outline"><a href="/api/people/template">Download CSV template</a></Button>
    <Label htmlFor="csv-file">Choose a CSV file</Label>
    <Input type="file" accept=".csv,text/csv" id="csv-file" onChange={async event => {
      const file = event.target.files?.[0];
      if (file) await state.run(async () => update(await file.text()));
    }}/>
    <Label htmlFor="csv-content">CSV content</Label>
    <Textarea id="csv-content" rows={7} value={csv} onChange={event => update(event.target.value)}/>
    <ErrorMessage text={state.error}/>
    {result?.errors.map((error, index) => <p role="alert" key={index}>Row {error.row}: {error.message.replaceAll('_', ' ')}</p>)}
    {result && !result.errors.length && <p role="status">Validation passed. The workspace will contain {result.rows.length} people.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={!csv || state.pending} onClick={() => void state.run(async () => setResult(await preview(csv)))}>Preview</Button>
      <Button type="button" disabled={!result || result.errors.length > 0 || state.pending} onClick={() => void state.run(() => apply(csv,result!.directoryVersion))}>Apply import</Button>
    </div>
  </div>;
}

type EditableQuestion = Pick<Template['questions'][number], 'text' | 'kind' | 'required'>;
const writtenQuestion: EditableQuestion = { text: '', kind: 'written', required: true };

export function TemplateEditor({ template, save }: { template?: Template; save: Save }) {
  const state = useSave();
  const [questions, setQuestions] = useState<EditableQuestion[]>(template?.questions ?? [writtenQuestion]);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void state.run(() => save({ ...fields, ...(template ? { family: template.family } : {}), questions }));
  }
  return <form className="form-stack" method="post" onSubmit={submit}>
    <Label htmlFor="template-name">Template name</Label>
    <Input id="template-name" name="name" required defaultValue={template?.name}/>
    <Label htmlFor="template-type">Review type</Label>
    <select id="template-type" className="native-select" name="type" defaultValue={template?.type}>
      {reviewTypes.map(type => <option key={type}>{type}</option>)}
    </select>
    <Label htmlFor="template-role">Participant role</Label>
    <select id="template-role" className="native-select" name="role" defaultValue={template?.role}>
      {roles.map(role => <option key={role}>{role}</option>)}
    </select>
    {questions.map((question, index) => <fieldset key={index} className="form-stack">
      <legend>Question {index + 1}</legend>
      <Input aria-label={`Question ${index + 1} text`} required value={question.text} onChange={event =>
        setQuestions(questions.map((item, i) => i === index ? { ...item, text: event.target.value } : item))}/>
      <select aria-label={`Question ${index + 1} type`} className="native-select" value={question.kind} onChange={event =>
        setQuestions(questions.map((item, i) => i === index ? { ...item, kind: event.target.value === 'rating' ? 'rating' : 'written' } : item))}>
        <option value="written">Written response</option><option value="rating">Rating from 1 to 5</option>
      </select>
      <label><input type="checkbox" checked={question.required} onChange={event =>
        setQuestions(questions.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))}/> Required</label>
      {questions.length > 1 && <Button type="button" variant="outline" onClick={() => setQuestions(questions.filter((_, i) => i !== index))}>Remove question</Button>}
    </fieldset>)}
    <ErrorMessage text={state.error}/>
    <Button type="button" variant="outline" disabled={questions.length >= 30} onClick={() => setQuestions([...questions, writtenQuestion])}>Add question</Button>
    <Button type="submit" disabled={state.pending}>Save template version</Button>
  </form>;
}

export function CycleEditor({ data, save }: { data: ReturnType<typeof workspace>; save: Save }) {
  const state = useSave();
  return <form className="form-stack" method="post" onSubmit={event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void state.run(() => save({ ...Object.fromEntries(fields),...Object.fromEntries(['start','nominationDue','reviewDue','releaseDate'].map(key=>[key,new Date(String(fields.get(key))).toISOString()])), participantIds: fields.getAll('participantIds'), templateIds: fields.getAll('templateIds') }));
  }}>
    <Label htmlFor="cycle-name">Cycle name</Label><Input id="cycle-name" name="name" required/>
    {(['start', 'nominationDue', 'reviewDue', 'releaseDate'] as const).map((name, index) => <div className="form-field" key={name}>
      <Label htmlFor={name}>{['Start date', 'Nomination deadline', 'Review deadline', 'Release date'][index]}</Label>
      <Input id={name} name={name} type="datetime-local" required/>
    </div>)}
    <fieldset><legend>Participants</legend>
      {data.people.filter(person => person.active).map(person => <label className="block" key={person.id}>
        <input type="checkbox" name="participantIds" value={person.id} aria-label={person.name}/> {person.name}
      </label>)}
    </fieldset>
    <fieldset><legend>Template versions</legend>
      {data.templates.map(template => <label className="block" key={template.id}>
        <input type="checkbox" name="templateIds" value={template.id} aria-label={`${template.name} · ${template.type} · v${template.version}`}/> {template.name} · {template.type} · {template.role} · v{template.version}
      </label>)}
    </fieldset>
    <ErrorMessage text={state.error}/>
    <Button type="submit" disabled={state.pending}>Create cycle</Button>
  </form>;
}

export function CycleSettings({ cycle, save }: { cycle: Cycle; save: Save }) {
  const state = useSave();
  return <form className="form-stack" method="post" onSubmit={event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const policy = Object.fromEntries(reviewTypes.map(type => [type, {
      include: fields.has(type + '-include'),
      disclose: fields.has(type + '-disclose'),
    }]));
    void state.run(() => save({ policy, ...Object.fromEntries(['start','nominationDue','reviewDue','releaseDate'].map(key=>[key,new Date(String(fields.get(key))).toISOString()])),minGroup:Number(fields.get('minGroup')) }));
  }}>
    <p>Nominations and approvals: start through nomination deadline. Reviews: start through review deadline. Release: on or after release date. Dates use your local timezone.</p>
    {(['start','nominationDue','reviewDue','releaseDate'] as const).map((key,index)=><div className="form-field" key={key}><Label htmlFor={key}>{['Start date','Nomination deadline','Review deadline','Release date'][index]}</Label><Input id={key} name={key} type="datetime-local" required defaultValue={new Date(Date.parse(cycle[key])-new Date(cycle[key]).getTimezoneOffset()*60000).toISOString().slice(0,16)}/></div>)}
    <Label htmlFor="minGroup">Minimum people for report aggregates (3–100)</Label><Input id="minGroup" name="minGroup" type="number" min={3} max={100} defaultValue={cycle.minGroup||3} required/>
    {reviewTypes.map(type => <fieldset key={type}><legend>{type}</legend>
      <label className="block"><input type="checkbox" name={type + '-include'} aria-label={`Include ${type} feedback in released results`} defaultChecked={cycle.policy[type].include}/> Include in released feedback</label>
      <label className="block"><input type="checkbox" name={type + '-disclose'} aria-label={`Show ${type} reviewer names`} defaultChecked={cycle.policy[type].disclose}/> Show reviewer name</label>
    </fieldset>)}
    <ErrorMessage text={state.error}/>
    <Button type="submit" disabled={state.pending}>Save cycle settings</Button>
  </form>;
}

export function ActionEditor({data,action,save}:{data:ReturnType<typeof workspace>;action?:DevelopmentAction;save:Save}) {
 const state=useSave();
 const [subject,setSubject]=useState(action?.subjectId||data.actionChoices[0]?.subjectId||'');
 const choices=data.actionChoices.find(x=>x.subjectId===subject);
 return <form className="form-stack" onSubmit={event=>{event.preventDefault();const fields=Object.fromEntries(new FormData(event.currentTarget));void state.run(()=>save({...fields,...(action?{id:action.id,revision:action.revision}:{})}));}}>
 <Label htmlFor="action-subject">For</Label><select className="native-select" id="action-subject" name="subjectId" value={subject} onChange={event=>setSubject(event.target.value)}>{data.actionChoices.filter(x=>!action||x.subjectId===action.subjectId).map(x=><option key={x.subjectId} value={x.subjectId}>{x.name}</option>)}</select>
 <Label htmlFor="action-owner">Owner</Label><select key={subject} className="native-select" id="action-owner" name="ownerId" defaultValue={action?.ownerId||subject}>{choices?.owners.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
 <Label htmlFor="action-title">Action</Label><Input id="action-title" name="title" required defaultValue={action?.title}/>
 <Label htmlFor="action-due">Due date</Label><Input id="action-due" name="due" type="date" required defaultValue={action?.due.slice(0,10)}/>
 <Label htmlFor="action-notes">Notes</Label><Textarea id="action-notes" name="notes" defaultValue={action?.notes}/>
 <Label htmlFor="action-progress">Progress</Label><select className="native-select" id="action-progress" name="progress" defaultValue={action?.progress||'planned'}>{['planned','in_progress','complete'].map(x=><option key={x}>{x}</option>)}</select>
 <ErrorMessage text={state.error}/><Button disabled={state.pending} type="submit">Save action</Button></form>;
}

export function StatusReason({ intro, confirmLabel, ariaLabel, destructive, cancel, confirm }: {
  intro: string; confirmLabel: string; ariaLabel: string; destructive?: boolean; cancel: () => void; confirm: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= 3;
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!ready) return; setBusy(true); try { await confirm(reason.trim()); } finally { setBusy(false); } }
  return <form className="space-y-4" onSubmit={submit}>
    <p>{intro}</p>
    <Label htmlFor="status-reason">Reason (required, recorded in the audit log)</Label>
    <Textarea id="status-reason" required minLength={3} maxLength={1000} rows={3} value={reason} onChange={event => setReason(event.target.value)}/>
    <div className="flex gap-2"><Button type="button" variant="outline" onClick={cancel}>Cancel</Button><Button type="submit" variant={destructive ? 'destructive' : 'default'} aria-label={ariaLabel} disabled={busy || !ready}>{confirmLabel}</Button></div>
  </form>;
}
