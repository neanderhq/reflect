'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'login' | 'recover' | 'setup' | 'redeem';
const headings = { login: 'Sign in', recover: 'Recover access', setup: 'Set up a workspace', redeem: 'Set a password' };

export default function Login() {
  const [mode, setMode] = useState<Mode>('login');
  const [link, setLink] = useState({ token: '', kind: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [next, setNext] = useState('/');
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const target = params.get('next');
    if (target && target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')) setNext(target);
    const token = params.get('token');
    const kind = params.get('kind');
    if (token && (kind === 'reset' || kind === 'invite')) {
      setLink({ token, kind });
      setMode('redeem');
      history.replaceState(null, '', '/login');
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setNotice('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/auth/' + mode, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lattice-Request': '1' },
        body: JSON.stringify({ ...fields, ...(mode === 'redeem' ? link : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error === 'RUNTIME_SECRETS_NOT_CONFIGURED' ? (data.details ?? data.error) : (data.error ?? 'Request failed'));
      if (mode === 'recover') setNotice('If the account exists and email delivery is configured, you will receive a reset link.');
      else location.assign(mode === 'login' ? next : '/');
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'Request failed.';
      setError(code === 'INVALID_CREDENTIALS' ? 'Check your workspace, email and password.' : code.startsWith('HR_SETUP_KEY must') ? code : code.replaceAll('_', ' ').toLowerCase());
    } finally {
      setPending(false);
    }
  }
  function navigate(next: Mode) {
    setNotice('');
    setError('');
    setMode(next);
  }
  return <main className="login-shell">
    <div className="brand"><span className="brand-symbol"><Layers3 size={24}/></span> Reflect</div>
    <Card>
      <CardHeader><CardTitle>{headings[mode]}</CardTitle></CardHeader>
      <CardContent>
        <form className="form-stack" method="post" onSubmit={submit}>
          {mode !== 'redeem' && <>
            <Label htmlFor="company">Workspace ID</Label><Input id="company" name="company" required autoComplete="organization"/>
            <Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required autoComplete="username"/>
          </>}
          {mode === 'setup' && <>
            <Label htmlFor="companyName">Company name</Label><Input id="companyName" name="companyName" required/>
            <Label htmlFor="name">Your name</Label><Input id="name" name="name" autoComplete="name" required/>
            <Label htmlFor="setupKey">Workspace setup key</Label><Input id="setupKey" type="password" name="setupKey" autoComplete="off" required/>
          </>}
          {mode !== 'recover' && <>
            <Label htmlFor="password">Password</Label><Input id="password" name="password" type="password"
              minLength={12} maxLength={256} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/>
          </>}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Please wait…' : headings[mode]}</Button>
        </form>
        <div className="login-options">
          {mode === 'login'
            ? <><Button variant="link" onClick={() => navigate('recover')}>Forgot password</Button>
              <Button variant="link" onClick={() => navigate('setup')}>Set up a new workspace</Button></>
            : <Button variant="link" onClick={() => navigate('login')}>Back to sign in</Button>}
        </div>
      </CardContent>
    </Card>
  </main>;
}
