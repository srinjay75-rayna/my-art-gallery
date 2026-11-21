import GalleryClient from '@/components/GalleryClient';
import { getPublicServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export default async function HomePage() {
  let paintings = [];
  let galleryError = '';
  try {
    const supabase = getPublicServerSupabaseClient();
    const { data, error } = await supabase.from('paintings')
      .select('id,title,medium,dimensions,price,weight_kg,length_cm,breadth_cm,height_cm,image_url,is_sold,artist_id,artist_name,avatar_url,is_approved,category')
      .eq('is_sold', false).eq('is_approved', true).order('created_at', { ascending: false });
    if (error) throw error;
    paintings = data || [];
  } catch (error) {
    console.error('Gallery load failed:', error.message);
    galleryError = 'The collection is temporarily unavailable. Please check the Artiste Supabase setup.';
  }
  let artists = [];
  try {
    const supabase = getPublicServerSupabaseClient();
    const { data, error } = await supabase.from('artists')
      .select('id,artist_name,avatar_url,city,state,bio,is_approved,is_suspended')
      .eq('is_approved', true)
      .eq('is_suspended', false)
      .order('artist_name');
    if (error) throw error;
    artists = data || [];
    const artistMap = new Map(artists.map((artist) => [artist.id, artist]));
    paintings = paintings.map((painting) => { const artist = artistMap.get(painting.artist_id); return artist ? { ...painting, artist_name: artist.artist_name, avatar_url: artist.avatar_url || painting.avatar_url } : painting; });
  } catch (error) { console.error('Artist showcase load failed:', error.message); }
  return <GalleryClient paintings={paintings} artists={artists} galleryError={galleryError} />;
}
