"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CircleUserRound, Menu, ShoppingBag, X, LogOut, UserRound, Store, Wallet, MapPin, FileText } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { hasEmailOtpSession } from '@/lib/client-auth';
import ArtisteLogo from '@/components/ArtisteLogo';

function initials(value) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] || 'A').slice(0, 2)).toUpperCase();
}

export default function SiteNavbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [identity, setIdentity] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef(null);
  const isGallerySurface = pathname === '/' || pathname === '/photography' || (pathname.startsWith('/artists/') && pathname.split('/').filter(Boolean).length === 2);

  useEffect(() => {
    let active = true;
    let revision = 0;
    let supabase;
    try { supabase = getBrowserSupabase(); } catch { setIdentity(null); return () => { active = false; }; }

    async function hydrate(session) {
      const currentRevision = ++revision;
      if (!session || !hasEmailOtpSession(session)) {
        if (active) setIdentity(null);
        return;
      }

      const metadata = session.user?.user_metadata || {};
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const kind = metadata.account_type;

      try {
        if (kind === 'artist') {
          const response = await fetch('/api/artist/profile', { headers, cache: 'no-store' });
          const data = await response.json().catch(() => ({}));
          const creator = data.artist || null;
          if (active && currentRevision === revision) setIdentity({
            kind: 'creator',
            name: creator?.artist_name || metadata.artist_name || metadata.full_name || 'Creator',
            avatar: creator?.avatar_url || creator?.profile_photo_url || metadata.avatar_url || metadata.picture || '',
            creatorRole: creator?.creator_role || metadata.creator_role || 'Painter',
          });
          return;
        }

        if (!kind) {
          const creatorResponse = await fetch('/api/artist/profile', { headers, cache: 'no-store' });
          if (creatorResponse.ok) {
            const creatorData = await creatorResponse.json().catch(() => ({}));
            if (creatorData.artist) {
              if (active && currentRevision === revision) setIdentity({
                kind: 'creator',
                name: creatorData.artist.artist_name || metadata.full_name || 'Creator',
                avatar: creatorData.artist.avatar_url || creatorData.artist.profile_photo_url || '',
                creatorRole: creatorData.artist.creator_role || 'Painter',
              });
              return;
            }
          }
        }

        const response = await fetch('/api/account', { headers, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (active && currentRevision === revision) setIdentity({
          kind: 'customer',
          name: data.profile?.full_name || metadata.full_name || metadata.name || 'Customer',
          avatar: metadata.avatar_url || metadata.picture || '',
        });
      } catch {
        if (active && currentRevision === revision) setIdentity({
          kind: kind === 'artist' ? 'creator' : 'customer',
          name: metadata.artist_name || metadata.full_name || metadata.name || (kind === 'artist' ? 'Creator' : 'Customer'),
          avatar: metadata.avatar_url || metadata.picture || '',
          creatorRole: metadata.creator_role || 'Painter',
        });
      }
    }

    supabase.auth.getSession().then(({ data }) => hydrate(data.session || null)).catch(() => setIdentity(null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      hydrate(nextSession || null);
    });
    return () => {
      active = false;
      revision += 1;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    function closeOnOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setProfileOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        setMobileOpen(false);
      }
    }
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function signOut() {
    try { await getBrowserSupabase().auth.signOut(); } finally {
      setIdentity(null);
      setProfileOpen(false);
      setMobileOpen(false);
      router.refresh();
    }
  }

  function openCart() {
    setMobileOpen(false);
    if (isGallerySurface) {
      window.dispatchEvent(new Event('artiste:open-cart'));
      return;
    }
    try { window.sessionStorage.setItem('artiste:open-cart', '1'); } catch {}
    router.push('/');
  }

  const navLinks = [
    { label: 'Collection', href: '/#gallery' },
    { label: 'Our Artists', href: '/artists' },
    { label: 'Journal', href: '/#journal' },
    { label: 'Sell Art', href: '/artist' },
  ];
  const customerLinks = [
    { label: 'My Profile & Address', href: '/account?tab=details', icon: MapPin },
    { label: 'My Orders & Bills', href: '/account?tab=orders', icon: FileText },
  ];
  const creatorLinks = [
    { label: 'Creator Studio & Stock', href: '/artist', icon: Store },
    { label: 'My Sales & Payouts', href: '/artist#earnings', icon: Wallet },
    { label: 'My Profile', href: '/artist#profile', icon: UserRound },
  ];

  return (
    <header className="site-navbar sticky top-0 z-50 border-b border-[#D9C6A6]/70 shadow-[0_5px_22px_rgba(38,56,50,.045)]">
      <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-5 md:px-10">
        <ArtisteLogo size={48} subtitle="THE INDIAN ART HOUSE · MY ART GALLERY" />
        <nav className="hidden items-center gap-8 text-[10px] font-bold uppercase tracking-[.17em] text-[#53615A] md:flex" aria-label="Main navigation">
          {navLinks.map((link) => <Link key={link.label} href={link.href} className="site-nav-link hover:text-[#B85D3B]">{link.label}</Link>)}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <button type="button" onClick={() => setMobileOpen((open) => !open)} className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D9C6A6] text-[#263832] md:hidden" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen}>
            {mobileOpen ? <X size={18}/> : <Menu size={18}/>}
          </button>

          <button type="button" onClick={openCart} className="inline-flex items-center gap-2 rounded-full border border-[#C69C6D]/70 bg-[#F3ECE1] px-3.5 py-2.5 text-[9px] font-bold uppercase tracking-[.13em] text-[#263832] transition hover:-translate-y-0.5 hover:border-[#B85D3B] hover:text-[#B85D3B] sm:px-4">
            <ShoppingBag size={15} strokeWidth={1.8} /><span>Cart</span>
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[#C69C6D] bg-[#F3ECE1] text-[#263832] shadow-sm transition hover:ring-4 hover:ring-[#C69C6D]/20"
              aria-label="Open profile menu"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              {identity?.avatar ? <img src={identity.avatar} alt="" className="h-full w-full object-cover" /> : identity ? <span className="font-serif text-sm font-semibold">{initials(identity.name)}</span> : <CircleUserRound size={23} strokeWidth={1.45} />}
            </button>

            {profileOpen && (
              <div className="profile-menu absolute right-0 top-[calc(100%+12px)] z-[70] w-[min(300px,calc(100vw-28px))] overflow-hidden rounded-2xl border border-[#D9C6A6] bg-[#FAF6F0] py-2" role="menu">
                {identity ? <>
                  <div className="flex items-center gap-3 border-b border-[#D9C6A6]/70 px-4 pb-3 pt-2">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#C69C6D] bg-[#F3ECE1]">
                      {identity.avatar ? <img src={identity.avatar} alt="" className="h-full w-full object-cover"/> : <span className="font-serif text-sm font-semibold">{initials(identity.name)}</span>}
                    </span>
                    <span className="min-w-0"><b className="block truncate text-sm text-[#263832]">{identity.name}</b><small className="mt-1 block text-[9px] uppercase tracking-[.15em] text-[#8A7864]">{identity.kind === 'creator' ? (identity.creatorRole === 'Photographer' ? 'Photographer' : 'Painter') : 'Customer account'}</small></span>
                  </div>
                  <div className="py-1">
                    {(identity.kind === 'creator' ? creatorLinks : customerLinks).map(({ label, href, icon: Icon }) => (
                      <Link key={label} href={href} role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-3 px-4 py-3 text-xs font-medium text-[#45534B] transition hover:bg-[#F3ECE1] hover:text-[#B85D3B]">
                        <Icon size={15} strokeWidth={1.7}/>{label}
                      </Link>
                    ))}
                  </div>
                  <button type="button" role="menuitem" onClick={signOut} className="flex w-full items-center gap-3 border-t border-[#D9C6A6]/70 px-4 py-3 text-left text-xs font-semibold text-[#B85D3B] transition hover:bg-[#F3ECE1]"><LogOut size={15}/>Sign Out</button>
                </> : <>
                  <p className="px-4 pb-2 pt-2 text-[9px] font-bold uppercase tracking-[.18em] text-[#8A7864]">Welcome to Artiste</p>
                  <Link href="/account" role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-3 px-4 py-3 text-xs font-semibold text-[#45534B] transition hover:bg-[#F3ECE1] hover:text-[#B85D3B]"><UserRound size={15}/>Customer Sign In / Sign Up</Link>
                  <Link href="/artist" role="menuitem" onClick={() => setProfileOpen(false)} className="flex items-center gap-3 px-4 py-3 text-xs font-semibold text-[#45534B] transition hover:bg-[#F3ECE1] hover:text-[#B85D3B]"><Store size={15}/>Painter &amp; Photographer Portal</Link>
                </>}
              </div>
            )}
          </div>

        </div>
      </div>

      {mobileOpen && (
        <nav className="border-t border-[#D9C6A6]/70 bg-[#FAF6F0] px-5 py-3 md:hidden" aria-label="Mobile navigation">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-1">
            {navLinks.map((link) => <Link key={link.label} href={link.href} onClick={() => setMobileOpen(false)} className="rounded-xl px-3 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#45534B] transition hover:bg-[#F3ECE1] hover:text-[#B85D3B]">{link.label}</Link>)}
          </div>
        </nav>
      )}
    </header>
  );
}
