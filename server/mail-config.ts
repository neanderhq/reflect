export const notConfigured='not delivered / provider not configured';
export function mailConfigured() {
  return (process.env.EMAIL_PROVIDER==='brevo' || process.env.EMAIL_PROVIDER==='resend') && !!process.env.EMAIL_API_KEY && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(process.env.EMAIL_FROM||'');
}
