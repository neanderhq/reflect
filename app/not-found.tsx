import { Layers3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return <main className="login-shell">
    <div className="brand"><span className="brand-symbol"><Layers3 size={24}/></span> Reflect</div>
    <Card>
      <CardHeader><CardTitle>Page not found</CardTitle></CardHeader>
      <CardContent>
        <p>This address is not part of your workspace.</p>
        <div className="login-options">
          <Button variant="link" asChild><a href="/">Open your workspace</a></Button>
          <Button variant="link" asChild><a href="/login">Go to sign in</a></Button>
        </div>
      </CardContent>
    </Card>
  </main>;
}
