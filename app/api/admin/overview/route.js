import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const supabase = requireServiceRole();
    async function fetchAll(makeQuery) {
      const rows = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await makeQuery().range(start, start + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    }
    const [artists, orders] = await Promise.all([
      fetchAll(() => supabase.from('artists').select('*').order('created_at', { ascending: false })),
      fetchAll(() => supabase.from('orders').select('*').order('created_at', { ascending: false })),
    ]);
    return NextResponse.json({ artists, orders });
  } catch (error) { return NextResponse.json({ error: error.message || 'Could not load admin overview.' }, { status: 500 }); }
}
