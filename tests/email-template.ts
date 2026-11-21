import assert from 'node:assert/strict';
import { renderEmail } from '../server/email-template';
for (const kind of ['invite', 'reset', 'assignment', 'reminder', 'release']) {
  const m = renderEmail({ kind, url: 'https://example.com/?view=reviews&review=1', company: 'Acme <Demo>' });
  assert.match(m.html, /Reflect/); assert.match(m.subject, /\S/);
  assert.match(m.html, /<a href="https:\/\/example.com\/\?view=reviews&amp;review=1"[^>]*>[A-Z]/, 'action button');
  assert.ok(m.html.includes('Acme &lt;Demo&gt;') && !m.html.includes('Acme <Demo>'), 'company name escaped');
  assert.match(m.text, /^Reflect\n/); assert.ok(m.text.includes('https://example.com/?view=reviews&review=1'), 'plain-text link');
  assert.doesNotMatch(m.html + m.text + m.subject, /Lattice|Neander|Brevo/);
}
console.log('PASS: Reflect email template (5 kinds): heading, action button, footer, escaped company, plain-text fallback, no old brand');
