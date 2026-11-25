import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicServerSupabaseClient } from '@/lib/supabase';
import GalleryClient from '@/components/GalleryClient';
import { BadgeCheck } from 'lucide-react';
export const dynamic = 'force-dynamic';
export default async function ArtistCollectionPage({ params }) {
  const { id } = await params;
  let supabase;
  let artist = null;
  try {
    supabase = getPublicServerSupabaseClient();
    let artistResult = await supabase.from('artists')
      .select('id,artist_name,avatar_url,city,state,bio,creator_role,is_approved,is_suspended')
      .eq('id', id).eq('is_approved', true).eq('is_suspended', false).maybeSingle();
    if (artistResult.error && /creator_role|schema cache/i.test(artistResult.error.message || '')) {
      artistResult = await supabase.from('artists')
        .select('id,artist_name,avatar_url,city,state,bio,is_approved,is_suspended')
        .eq('id', id).eq('is_approved', true).eq('is_suspended', false).maybeSingle();
    }
    if (artistResult.error) throw artistResult.error;
    artist = artistResult.data || null;
  } catch (error) {
    console.error('Artist profile query failed:', error?.message || error);
    return <main className="paper-grain min-h-screen px-5 py-16"><div className="mx-auto max-w-3xl rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-8 text-center"><h1 className="font-display text-3xl">This Artist profile is temporarily unavailable.</h1><p className="mt-3 text-sm leading-7 text-muted">Please refresh shortly or return to the Artist directory.</p><Link href="/artists" className="btn-primary mt-6 inline-flex">Back to Our Artists</Link></div></main>;
  }
  if (!artist) notFound();
  artist.creator_role = artist.creator_role === 'Photographer' ? 'Photographer' : 'Painter';

  const fullColumns = 'id,title,medium,dimensions,price,weight_kg,length_cm,breadth_cm,height_cm,image_url,is_sold,artist_id,artist_name,avatar_url,is_approved,category,stock_quantity,edition_details,print_details,gallery_images,framed_status,certificate_id,description,delivery_format,delivery_format_other,created_at';
  const legacyColumns = 'id,title,medium,dimensions,price,image_url,is_sold,artist_id,artist_name,avatar_url,is_approved,created_at';
  // Retry with the core legacy projection if an older database has not yet
  // applied one of the optional photography / stock columns.
  const escapedArtistName = String(artist.artist_name || '').replace(/[\\%_]/g, '\\$&');
  let matchedPaintings = [];
  let portfolioError = '';
  try {
    const queryWorks = async (columns) => Promise.all([
      supabase.from('paintings').select(columns).eq('artist_id', artist.id).eq('is_approved', true).order('created_at', { ascending: false }),
      supabase.from('paintings').select(columns).ilike('artist_name', escapedArtistName).eq('is_approved', true).order('created_at', { ascending: false }),
    ]);
    let [byArtistId, byArtistName] = await queryWorks(fullColumns);
    const combinedError = byArtistId.error || byArtistName.error;
    if (combinedError && /stock_quantity|edition_details|print_details|gallery_images|framed_status|certificate_id|description|category|weight_kg|length_cm|breadth_cm|height_cm|delivery_format|delivery_format_other|schema cache|does not exist/i.test(combinedError.message || '')) {
      [byArtistId, byArtistName] = await queryWorks(legacyColumns);
    }
    if (byArtistId.error) throw byArtistId.error;
    if (byArtistName.error) throw byArtistName.error;
    const uniquePaintings = new Map();
    for (const painting of [...(byArtistId.data || []), ...(byArtistName.data || [])]) {
      if (painting?.id != null) uniquePaintings.set(String(painting.id), painting);
    }
    matchedPaintings = [...uniquePaintings.values()]
      .map((painting) => ({
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
      }))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  } catch (error) {
    console.error('Artist portfolio query failed:', error?.message || error);
    portfolioError = 'This collection is temporarily unavailable. Please refresh shortly.';
  }
  const enrichedPaintings = matchedPaintings.map(p => ({ ...p, artist_name: artist.artist_name, creator_role: artist.creator_role || 'Painter', avatar_url: artist.avatar_url || p.avatar_url }));
  const available = enrichedPaintings.filter(p => !p.is_sold && Number(p.stock_quantity ?? 1) > 0);
  const sold = enrichedPaintings.filter(p => p.is_sold || Number(p.stock_quantity ?? 1) <= 0);
  return <div className="paper-grain min-h-screen"><section className="mx-auto max-w-6xl px-5 py-14 text-center md:px-10"><Link href="/artists" className="text-xs font-bold uppercase tracking-widest text-clay">← All Artists</Link><span className="mx-auto mt-9 flex h-48 w-48 items-center justify-center overflow-hidden rounded-full border-[7px] border-[#efe3d5] bg-[#eadbca] font-display text-7xl text-clay">{artist.avatar_url ? <img src={artist.avatar_url} alt={artist.artist_name} className="h-full w-full object-cover"/> : (artist.artist_name || 'A').slice(0,1).toUpperCase()}</span><span className="mx-auto mt-7 inline-flex items-center gap-2 rounded-full border border-[#C69C6D]/75 bg-[#F3ECE1] px-4 py-2 text-[9px] font-bold uppercase tracking-[.16em] text-[#53615A]"><BadgeCheck size={14} className="text-[#B85D3B]"/> Verified {artist.creator_role === 'Photographer' ? 'Photographer' : 'Painter'}</span><h1 className="mt-2 font-display text-6xl">{artist.artist_name}</h1><p className="mt-3 text-xs uppercase tracking-widest text-muted">{[artist.city,artist.state].filter(Boolean).join(', ') || 'India'}</p><p className="mx-auto mt-6 max-w-3xl whitespace-pre-line text-sm leading-8 text-muted">{artist.bio || 'An independent creator sharing original works through Artiste.'}</p></section> {portfolioError && <div role="status" className="mx-auto max-w-7xl px-5"><p className="rounded-xl border border-[#D9C6A6] bg-[#F3ECE1] p-4 text-sm text-muted">{portfolioError}</p></div>}<GalleryClient paintings={available} artists={[artist]} pageMode="collection" collectionArtistName={artist.artist_name} />{sold.length > 0 && <section className="mx-auto max-w-7xl px-5 pb-20 md:px-10"><div className="mb-7 border-b border-[#D9C6A6] pb-5"><p className="eyebrow">Collected works</p><h2 className="mt-2 font-display text-4xl">Previously sold originals</h2></div><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{sold.map(p => <article key={p.id} className="overflow-hidden rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] opacity-80"><div className="aspect-[4/4.5] bg-[#e9ddce]">{p.image_url ? <img src={p.image_url} alt={p.title} className="h-full w-full object-cover"/> : <div className="flex h-full items-center justify-center font-display text-5xl text-clay">A</div>}</div><div className="p-5"><p className="text-[9px] uppercase tracking-widest text-clay">{p.category === 'Photography' ? 'Fine-Art Photography' : 'Original Painting'} · {p.medium}</p><h3 className="mt-2 font-display text-2xl">{p.title}</h3><p className="mt-2 text-xs text-muted">{p.dimensions}</p><span className="mt-4 inline-block rounded-full bg-stone-100 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-stone-600">Collected · Sold</span></div></article>)}</div></section>}</div>;
}
