const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;

export async function postAccountingVoucher(supabase, {
  description,
  voucherType,
  reference = '',
  postingKey = null,
  lines,
  voucherDate = new Date().toISOString().slice(0, 10),
}) {
  const { data, error } = await supabase.rpc('artiste_post_accounting_voucher', {
    p_description: description,
    p_voucher_date: voucherDate,
    p_voucher_type: voucherType || 'journal',
    p_reference: reference,
    p_posting_key: postingKey,
    p_lines: lines,
  });
  if (error) throw error;
  return data;
}

export async function postPaidOrderAccounting(supabase, order, items) {
  const ledgerCodes = ['1000', '2000', '2010', '4000', '4100', '5000'];
  const { data: ledgers, error: ledgerError } = await supabase
    .from('accounting_ledgers')
    .select('id,ledger_code')
    .in('ledger_code', ledgerCodes);
  if (ledgerError) throw ledgerError;
  const byCode = new Map((ledgers || []).map((ledger) => [ledger.ledger_code, ledger.id]));
  if (ledgerCodes.some((code) => !byCode.get(code))) throw new Error('Default sales accounting ledgers are missing. Run database/schema.sql.');

  const artworkGross = roundMoney(items.reduce((sum, item) => sum + Number(item.price || 0), 0));
  const artistPayable = roundMoney(items.reduce((sum, item) => sum + Number(item.artist_payout || 0), 0));
  const platformCommission = roundMoney(items.reduce((sum, item) => sum + Number(item.platform_fee || 0), 0));
  const shippingRecovery = roundMoney(order.shipping_amount ?? order.shipping_price ?? 0);
  const courierCost = roundMoney(order.courier_cost ?? shippingRecovery);
  const collected = roundMoney(artworkGross + shippingRecovery);
  const debits = roundMoney(collected + courierCost);
  const credits = roundMoney(artistPayable + platformCommission + shippingRecovery + courierCost);
  if (Math.abs(debits - credits) > 0.02 || collected <= 0) {
    throw new Error('The paid order allocation did not balance; owner review is required.');
  }
  return postAccountingVoucher(supabase, {
    description: `Paid artwork order · ${order.merchant_order_ref || order.id}`,
    voucherType: 'sale',
    reference: order.merchant_order_ref || order.id,
    postingKey: `paid-order:${order.id}`,
    lines: [
      { ledger_id: byCode.get('1000'), debit: collected, credit: 0, description: 'Customer payment captured by Razorpay' },
      ...(courierCost > 0 ? [{ ledger_id: byCode.get('5000'), debit: courierCost, credit: 0, description: 'Shiprocket quoted dispatch cost accrued' }] : []),
      ...(artistPayable > 0 ? [{ ledger_id: byCode.get('2000'), debit: 0, credit: artistPayable, description: 'Artist net payout payable' }] : []),
      ...(courierCost > 0 ? [{ ledger_id: byCode.get('2010'), debit: 0, credit: courierCost, description: 'Shiprocket courier cost payable' }] : []),
      ...(platformCommission > 0 ? [{ ledger_id: byCode.get('4000'), debit: 0, credit: platformCommission, description: 'Artiste commission revenue' }] : []),
      ...(shippingRecovery > 0 ? [{ ledger_id: byCode.get('4100'), debit: 0, credit: shippingRecovery, description: 'Customer shipping recovery' }] : []),
    ],
  });
}
