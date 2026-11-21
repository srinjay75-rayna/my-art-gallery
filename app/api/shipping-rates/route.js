import { NextResponse } from 'next/server';
import { requireServiceRole } from '@/lib/supabase';
import { getCourierRates } from '@/lib/shiprocket';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const { items, paintingId, deliveryPincode } = await request.json();
    const ids = Array.isArray(items) ? [...new Set(items.map((item) => String(item.paintingId || item.id || '')))] : [String(paintingId || '')];
    if (!ids.length || ids.some((id) => !id)) return NextResponse.json({ error: 'Your cart is empty or contains an invalid artwork.' }, { status: 400 });
    const supabase = requireServiceRole();
    const { data: paintings, error } = await supabase.from('paintings')
      .select('id,title,price,weight_kg,length_cm,breadth_cm,height_cm,is_sold,is_approved')
      .in('id', ids).eq('is_sold', false).eq('is_approved', true);
    if (error) throw error;
    if (!paintings || paintings.length !== ids.length) return NextResponse.json({ error: 'One or more artworks are sold or no longer available.' }, { status: 409 });
    const couriers = await getCourierRates({ paintings, deliveryPincode });
    return NextResponse.json({ couriers, package: {
      items: paintings.length,
      weight_kg: paintings.reduce((s, p) => s + Number(p.weight_kg), 0),
      length_cm: Math.max(...paintings.map((p) => Number(p.length_cm))),
      breadth_cm: Math.max(...paintings.map((p) => Number(p.breadth_cm))),
      height_cm: Math.max(...paintings.map((p) => Number(p.height_cm))),
    } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not fetch courier options.' }, { status: 500 });
  }
}
