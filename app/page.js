import GalleryClient from '@/components/GalleryClient';
import { getSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let paintings = [];
  let galleryError = '';
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('paintings')
      .select('id,title,medium,dimensions,price,weight_kg,length_cm,breadth_cm,height_cm,image_url,is_sold,artist_id,artist_name,is_approved')
      .eq('is_sold', false).eq('is_approved', true).order('created_at', { ascending: false });
    if (error) throw error;
    paintings = data || [];
  } catch (error) {
    console.error('Gallery load failed:', error.message);
    galleryError = 'The gallery is temporarily unavailable. Please check your Supabase setup.';
  }
  return <GalleryClient paintings={paintings} galleryError={galleryError} />;
}
