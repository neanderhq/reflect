// One layout for every Reflect email: product heading, readable spacing, a clear action button,
// a small footer, and a matching plain-text fallback. Notices never include review content.
export const PRODUCT_NAME = 'Reflect';

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const copy: Record<string, { subject: string; heading: string; body: string; action: string }> = {
  invite: { subject: 'Your Reflect invitation', heading: "You're invited to Reflect", body: 'Your company uses Reflect for performance reviews. Set your password to activate your account. The link works once and expires in 1 hour.', action: 'Set your password' },
  reset: { subject: 'Reset your Reflect password', heading: 'Reset your password', body: 'Use this link to choose a new password. It works once and expires in 1 hour. If you did not ask for a reset, you can ignore this email.', action: 'Choose a new password' },
  assignment: { subject: 'You have a review to complete', heading: 'You have a review to complete', body: 'A performance review is waiting for you in Reflect. Your answers are saved as a private draft until you submit.', action: 'Open the review' },
  reminder: { subject: 'Reminder: a review is due soon', heading: 'A review is due soon', body: 'You still have a performance review to complete before the deadline.', action: 'Open the review' },
  release: { subject: 'Your review results are available', heading: 'Your review results are available', body: 'Your released review results are ready to read and acknowledge in Reflect.', action: 'View your results' },
};

export function renderEmail(v: { kind: string; url: string; company?: string }) {
  const c = copy[v.kind] ?? { subject: 'Reflect notification', heading: 'Reflect notification', body: 'You have an update in Reflect.', action: 'Open Reflect' };
  const company = v.company?.trim() || PRODUCT_NAME;
  const privacy = 'For privacy, this email never includes review content.';
  const footer = `Sent by ${PRODUCT_NAME} on behalf of ${company}. This link is personal: please do not forward this email.`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border-top:4px solid #4f46e5">
<tr><td style="padding:28px 32px 8px"><div style="font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#4f46e5">${PRODUCT_NAME}</div></td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#111827">${escapeHtml(c.heading)}</h1>
<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#374151">${escapeHtml(c.body)}</p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#6b7280">${escapeHtml(privacy)}</p></td></tr>
<tr><td style="padding:0 32px 28px"><a href="${escapeHtml(v.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${escapeHtml(c.action)}</a>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#6b7280">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;color:#374151">${escapeHtml(v.url)}</span></p></td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.5;color:#6b7280">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [PRODUCT_NAME, '', c.heading, '', c.body, privacy, '', `${c.action}: ${v.url}`, '', '--', footer].join('\n');
  return { subject: c.subject, html, text };
}
