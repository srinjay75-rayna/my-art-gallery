import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { getCourierRates } from '@/lib/shiprocket';

export const runtime = 'nodejs';

export async function POST(request) {
  try {
    const { paintingId, deliveryPincode } = await request.json();
    if (!paintingId || !/^\d{6}$/.test(String(deliveryPincode || ''))) {
      return NextResponse.json({ error: 'A painting and a valid 6-digit delivery PIN code are required.' }, { status: 400 });
    }
    const supabase = getSupabaseClient();
    const { data: painting, error } = await supabase.from('paintings')
      .select('id,title,price,weight_kg,length_cm,breadth_cm,height_cm,is_sold')
      .eq('id', paintingId).eq('is_sold', false).maybeSingle();
    if (error) throw error;
    if (!painting) return NextResponse.json({ error: 'This artwork is no longer available.' }, { status: 404 });
    const couriers = await getCourierRates({ painting, deliveryPincode: String(deliveryPincode) });
    return NextResponse.json({ couriers });
  } catch (error) {
    console.error('Shipping rate lookup failed:', error.message);
    return NextResponse.json({ error: error.message || 'Could not fetch live shipping rates.' }, { status: 502 });
  }
}
