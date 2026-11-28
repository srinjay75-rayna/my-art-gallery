import GalleryClient from '@/components/GalleryClient';
import { getPublicServerSupabaseClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export default async function HomePage() {
  let paintings = [];
  let galleryError = '';
  try {
    const supabase = getPublicServerSupabaseClient();
    let result = await supabase.from('paintings')
      .select('id,title,medium,dimensions,price,weight_kg,length_cm,breadth_cm,height_cm,image_url,is_sold,artist_id,artist_name,avatar_url,is_approved,category,stock_quantity,edition_details,print_details,gallery_images,framed_status,certificate_id,description,delivery_format,delivery_format_other,artist_fee_grade_1,print_lab_managed')
      .eq('is_sold', false).gt('stock_quantity', 0).eq('is_approved', true).order('created_at', { ascending: false });
    if (result.error && /stock_quantity|edition_details|print_details|gallery_images|framed_status|certificate_id|description|category|weight_kg|length_cm|breadth_cm|height_cm|delivery_format|delivery_format_other|schema cache|does not exist/i.test(result.error.message || '')) {
      // Keep legacy paintings visible if an optional V9 column migration is still pending.
      result = await supabase.from('paintings')
        .select('id,title,medium,dimensions,price,image_url,is_sold,artist_id,artist_name,avatar_url,is_approved,created_at')
        .eq('is_sold', false).eq('is_approved', true).order('created_at', { ascending: false });
    }
    if (result.error) throw result.error;
    paintings = (result.data || []).map((painting) => ({
      ...painting,
      category: painting.category === 'Photography' ? 'Photography' : 'Painting',
      stock_quantity: painting.stock_quantity == null ? (painting.is_sold ? 0 : 1) : Number(painting.stock_quantity),
      edition_details: painting.edition_details || '',
      print_details: painting.print_details || '',
      gallery_images: Array.isArray(painting.gallery_images) ? painting.gallery_images : [painting.image_url].filter(Boolean),
      framed_status: painting.framed_status || 'Unframed',
      certificate_id: painting.certificate_id || '',
      description: painting.description || '',
      delivery_format: painting.delivery_format || 'Stretched Canvas (Gallery-Wrapped, Unframed)',
      delivery_format_other: painting.delivery_format_other || '',
    }));
  } catch (error) {
    console.error('Gallery load failed:', error.message);
    galleryError = 'The collection is temporarily unavailable. Please check the Artiste Supabase setup.';
  }
  let artists = [];
  try {
    const supabase = getPublicServerSupabaseClient();
    let artistResult = await supabase.from('artists')
      .select('id,artist_name,avatar_url,city,state,bio,creator_role,is_approved,is_suspended')
      .eq('is_approved', true)
      .eq('is_suspended', false)
      .order('artist_name');
    if (artistResult.error && /creator_role|schema cache|does not exist/i.test(artistResult.error.message || '')) {
      artistResult = await supabase.from('artists')
        .select('id,artist_name,avatar_url,city,state,bio,is_approved,is_suspended')
        .eq('is_approved', true)
        .eq('is_suspended', false)
        .order('artist_name');
    }
    if (artistResult.error) throw artistResult.error;
    artists = (artistResult.data || []).map((artist) => ({ ...artist, creator_role: artist.creator_role === 'Photographer' ? 'Photographer' : 'Painter' }));
    const artistMap = new Map(artists.map((artist) => [artist.id, artist]));
    try {
      const { data: achievementRows, error: achievementsError } = await supabase.from('artist_achievements').select('id,artist_id,title,achievement_year,description,photo_urls,created_at').in('artist_id', artists.map((artist) => artist.id));
      if (achievementsError) throw achievementsError;
      for (const row of achievementRows || []) {
        const creator = artistMap.get(row.artist_id);
        if (creator) creator.achievements = [...(creator.achievements || []), { ...row, photo_urls: Array.isArray(row.photo_urls) ? row.photo_urls : [] }];
      }
    } catch (achievementError) { console.error('Artist achievement showcase is unavailable:', achievementError.message); }
    paintings = paintings.map((painting) => { const artist = artistMap.get(painting.artist_id); return artist ? { ...painting, artist_name: artist.artist_name, creator_role: artist.creator_role || 'Painter', avatar_url: artist.avatar_url || painting.avatar_url } : painting; });
  } catch (error) { console.error('Artist showcase load failed:', error.message); }
  return <GalleryClient paintings={paintings} artists={artists} galleryError={galleryError} />;
}
