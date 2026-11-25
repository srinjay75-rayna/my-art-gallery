import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const supabase = requireServiceRole();
    const [ledgers, vouchers, entries] = await Promise.all([
      fetchAll(() => supabase.from('accounting_ledgers').select('*').order('ledger_code', { ascending: true })),
      fetchAll(() => supabase.from('accounting_vouchers').select('*').order('voucher_date', { ascending: false })),
      fetchAll(() => supabase.from('accounting_entries').select('*').order('created_at', { ascending: false })),
    ]);
    const ledgerMap = new Map(ledgers.map((ledger) => [ledger.id, ledger]));
    const voucherMap = new Map(vouchers.map((voucher) => [voucher.id, voucher]));
    const enrichedEntries = entries.map((entry) => ({
      ...entry,
      ledger: ledgerMap.get(entry.ledger_id) || null,
      voucher: voucherMap.get(entry.voucher_id) || null,
    }));
    return NextResponse.json({ ledgers, vouchers, entries: enrichedEntries });
  } catch (error) {
    return NextResponse.json({ error: `${error.message || 'Could not load accounting ledgers.'} Run the V17 section of database/schema.sql if the accounting tables are missing.` }, { status: 500 });
  }
}

export async function POST(request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const body = await request.json();
    const supabase = requireServiceRole();
    if (body.action === 'create_ledger') {
      const code = String(body.ledger_code || '').trim().slice(0, 24);
      const name = String(body.ledger_name || '').trim().slice(0, 100);
      const type = String(body.ledger_type || '').trim().toLowerCase();
      if (!code || !name || !['asset', 'liability', 'equity', 'income', 'expense'].includes(type)) {
        return NextResponse.json({ error: 'Enter a ledger code, name, and valid account type.' }, { status: 400 });
      }
      const { data, error } = await supabase.from('accounting_ledgers').insert({
        ledger_code: code, ledger_name: name, ledger_type: type,
        description: String(body.description || '').trim().slice(0, 500), is_system: false,
      }).select('*').single();
      if (error) throw error;
      return NextResponse.json({ ledger: data }, { status: 201 });
    }
    if (body.action === 'post_voucher') {
      const description = String(body.description || '').trim().slice(0, 240);
      const reference = String(body.reference || '').trim().slice(0, 120);
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!description || lines.length < 2) return NextResponse.json({ error: 'A voucher description and at least two ledger lines are required.' }, { status: 400 });
      const { data, error } = await supabase.rpc('artiste_post_accounting_voucher', {
        p_description: description,
        p_voucher_date: body.voucher_date || new Date().toISOString().slice(0, 10),
        p_voucher_type: 'manual',
        p_reference: reference,
        p_posting_key: null,
        p_lines: lines,
      });
      if (error) throw error;
      return NextResponse.json({ voucherId: data, message: 'Balanced journal voucher posted.' }, { status: 201 });
    }
    return NextResponse.json({ error: 'Unsupported accounting action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save accounting record.' }, { status: 400 });
  }
}
