import { cookies } from 'next/headers';
import { ADMIN_COOKIE, verifyAdminToken } from '@/lib/admin-auth';
import AdminDashboard from '@/components/AdminDashboard';
import AdminLogin from '@/components/AdminLogin';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Studio Vault | Artiste',
  robots: { index: false, follow: false, noarchive: true },
};

export default async function StudioVaultOwnerPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE)?.value || '';
  return verifyAdminToken(token) ? <AdminDashboard /> : <AdminLogin />;
}
