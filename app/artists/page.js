import Link from 'next/link';
import { getPublicServerSupabaseClient } from '@/lib/supabase';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Our Artists | Artiste', description: 'Meet independent Indian artists and fine-art photographers and explore their original collections.' };
export default async function ArtistsPage() {
  const supabase = getPublicServerSupabaseClient();
  const { data: visible, error } = await supabase.from('artists')
    .select('id,artist_name,avatar_url,city,state,bio,creator_role,is_approved,is_suspended')
    .eq('is_approved', true)
    .eq('is_suspended', false)
    .order('artist_name');
  if (error) throw error;
  return <main className="paper-grain min-h-screen px-5 py-14 md:px-10"><div className="mx-auto max-w-7xl"><Link href="/" className="text-xs font-bold uppercase tracking-widest text-clay">← Back to Gallery</Link><p className="eyebrow mt-10">Independent Indian studios</p><h1 className="mt-3 font-display text-6xl">Our <em className="font-normal text-clay">Creators — Artists &amp; Photographers.</em></h1><p className="mt-4 max-w-2xl text-sm leading-7 text-muted">Meet the people, places and practices behind the original works in the Artiste collection.</p><div className="mt-12 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">{visible.map(a => <Link href={`/artists/${a.id}`} key={a.id} className="group rounded-3xl border border-[#e7ded2] bg-[#fffdf8] p-8 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-soft"><span className="mx-auto flex h-44 w-44 items-center justify-center overflow-hidden rounded-full border-[6px] border-[#f0e5d8] bg-[#eadbca] font-display text-6xl text-clay">{a.avatar_url ? <img src={a.avatar_url} alt={a.artist_name} className="h-full w-full object-cover"/> : (a.artist_name || 'A').slice(0,1).toUpperCase()}</span><p className="mt-5 text-[9px] font-bold uppercase tracking-[.18em] text-clay">{a.creator_role === 'Photographer' ? 'Photographer · Photography Studio' : 'Artist · Artist Studio'}</p><h2 className="mt-2 font-display text-3xl group-hover:text-clay">{a.artist_name}</h2><p className="mt-1 text-[10px] uppercase tracking-widest text-muted">{[a.city,a.state].filter(Boolean).join(', ') || 'India'}</p><p className="mx-auto mt-4 line-clamp-3 max-w-sm text-sm leading-6 text-muted">{a.bio || 'Explore this creator’s original works and creative practice.'}</p><span className="mt-5 inline-block text-[10px] font-bold uppercase tracking-widest text-clay">View collection ↗</span></Link>)}</div>{!visible.length && <p className="mt-12 rounded-2xl border border-dashed p-10 text-center text-sm text-muted">Artist collections are being prepared. Please visit again soon.</p>}</div></main>;
}
