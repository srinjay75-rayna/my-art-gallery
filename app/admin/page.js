import { redirect } from 'next/navigation';

// Legacy public route intentionally reveals no owner tooling.
export default function LegacyAdminRoute() {
  redirect('/');
}
