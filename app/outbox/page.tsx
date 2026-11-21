import { redirect } from 'next/navigation';

export default function OutboxPage() {
  redirect('/?view=outbox');
}
