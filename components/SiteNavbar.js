"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  CircleUserRound,
  Menu,
  ShoppingBag,
  X,
  LogOut,
  UserRound,
  Store,
  Wallet,
  MapPin,
  FileText,
} from 'lucide-react';

import {
  clearPortalSession,
  getPortalSession,
  portalFetch,
  subscribePortalSession,
} from '@/lib/client-auth';

import ArtisteLogo from '@/components/ArtisteLogo';

function initials(value) {
  const words = String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (
    words.length > 1
      ? `${words[0][0]}${words[1][0]}`
      : (words[0] || 'A').slice(0, 2)
  ).toUpperCase();
}

export default function SiteNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [identity, setIdentity] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuRef = useRef(null);
  const lastPortalSessionKeyRef = useRef('');

  const isGallerySurface =
    pathname === '/' ||
    pathname === '/photography' ||
    (
      pathname.startsWith('/artists/') &&
      pathname.split('/').filter(Boolean).length === 2
    );

  /* ==========================================
     UNIFIED PORTAL SESSION

     - Reads active session on mount.
     - Supports Artist and Customer accounts.
     - Listens to same-tab authentication events.
     - Listens to cross-tab storage events.
     - Displays identity immediately from session metadata.
     - Enriches identity using the relevant profile API.
     - Prevents duplicate hydration for the same session.
  ========================================== */

  useEffect(() => {
    let active = true;
    let revision = 0;

    async function hydratePortalIdentity(session) {
      const currentRevision = ++revision;

      const metadata = session?.user?.user_metadata || {};

      const accountType =
        session?.accountType ||
        metadata.account_type;

      let initialIdentity = null;

      if (accountType === 'artist') {
        initialIdentity = {
          kind: 'creator',

          name:
            metadata.artist_name ||
            metadata.full_name ||
            session?.user?.email?.split('@')[0] ||
            'Creator',

          avatar:
            metadata.avatar_url ||
            metadata.picture ||
            '',

          creatorRole:
            session?.creatorRole ||
            metadata.creator_role ||
            'Painter',
        };
      } else if (accountType === 'customer') {
        initialIdentity = {
          kind: 'customer',

          name:
            metadata.full_name ||
            metadata.name ||
            session?.user?.email?.split('@')[0] ||
            'Customer',

          avatar:
            metadata.avatar_url ||
            metadata.picture ||
            '',
        };
      }

      if (!active) return;

      // Render the active identity immediately.
      setIdentity(initialIdentity);

      if (!initialIdentity) return;

      try {
        const endpoint =
          initialIdentity.kind === 'creator'
            ? '/api/artist/profile'
            : '/api/account';

        const response = await portalFetch(endpoint, {
          cache: 'no-store',
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) return;

        let resolvedIdentity = initialIdentity;

        if (initialIdentity.kind === 'creator') {
          const creator = data.artist || null;

          if (creator) {
            resolvedIdentity = {
              ...initialIdentity,

              name:
                creator.artist_name ||
                initialIdentity.name,

              avatar:
                creator.avatar_url ||
                creator.profile_photo_url ||
                initialIdentity.avatar,

              creatorRole:
                creator.creator_role ||
                initialIdentity.creatorRole,
            };
          }
        } else {
          const profile = data.profile || null;

          if (profile) {
            resolvedIdentity = {
              ...initialIdentity,

              name:
                profile.full_name ||
                initialIdentity.name,

              avatar:
                profile.avatar_url ||
                profile.profile_photo_url ||
                initialIdentity.avatar,
            };
          }
        }

        // A previous request must never overwrite a newer login.
        if (active && currentRevision === revision) {
          setIdentity(resolvedIdentity);
        }
      } catch {
        // Keep the already-rendered session metadata identity.
      }
    }

    const syncPortalSession = () => {
      if (!active) return;

      const session = getPortalSession();
      const metadata = session?.user?.user_metadata || {};

      const sessionKey = session?.access_token
        ? JSON.stringify([
            session.access_token,
            session.user?.id || '',
            session.accountType || metadata.account_type || '',
            session.creatorRole || metadata.creator_role || '',
            metadata.artist_name || '',
            metadata.full_name || metadata.name || '',
            metadata.avatar_url || metadata.picture || '',
          ])
        : 'signed-out';

      // Ignore duplicate notifications for the same session.
      if (lastPortalSessionKeyRef.current === sessionKey) return;

      lastPortalSessionKeyRef.current = sessionKey;

      hydratePortalIdentity(session);
    };

    // Read current session on mount.
    syncPortalSession();

    // Listen for login/logout and cross-tab session updates.
    const unsubscribe = subscribePortalSession(syncPortalSession);

    return () => {
      active = false;
      revision += 1;
      unsubscribe();
    };
  }, []);

  /* ==========================================
     CLOSE PROFILE / MOBILE MENU
  ========================================== */

  useEffect(() => {
    function closeOnOutside(event) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target)
      ) {
        setProfileOpen(false);
      }
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

  /* ==========================================
     UNIFIED SIGN OUT
  ========================================== */

  async function signOut() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
    } catch {
      // Local credentials are still cleared if the server cannot be reached.
    } finally {
      clearPortalSession();

      setIdentity(null);
      setProfileOpen(false);
      setMobileOpen(false);

      router.refresh();
    }
  }

  /* ==========================================
     CART NAVIGATION
  ========================================== */

  function openCart() {
    setMobileOpen(false);

    if (isGallerySurface) {
      window.dispatchEvent(new Event('artiste:open-cart'));
      return;
    }

    try {
      window.sessionStorage.setItem('artiste:open-cart', '1');
    } catch {
      // Ignore sessionStorage restrictions.
    }

    router.push('/');
  }

  /* ==========================================
     NAVIGATION LINKS
  ========================================== */

  const navLinks = [
    { label: 'Collection', href: '/#gallery' },
    { label: 'Our Artists', href: '/artists' },
    { label: 'Journal', href: '/#journal' },
    { label: 'Sell Art', href: '/artist' },
  ];

  const customerLinks = [
    {
      label: 'My Profile',
      href: '/account',
      icon: UserRound,
    },
    {
      label: 'Edit Details',
      href: '/account?tab=details',
      icon: MapPin,
    },
    {
      label: 'My Orders',
      href: '/account?tab=orders',
      icon: FileText,
    },
  ];

  const creatorLinks = [
    {
      label: 'Creator Studio',
      href: '/artist',
      icon: Store,
    },
    {
      label: 'Edit Details',
      href: '/artist#profile',
      icon: UserRound,
    },
    {
      label: 'My Profile',
      href: '/artist#profile',
      icon: MapPin,
    },
    {
      label: 'Sales & Payouts',
      href: '/artist#earnings',
      icon: Wallet,
    },
  ];

  /* ==========================================
     NAVBAR UI
  ========================================== */

  return (
    <header className="site-navbar sticky top-0 z-50 border-b border-[#D9C6A6]/70 shadow-[0_5px_22px_rgba(38,56,50,.045)]">

      <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-5 md:px-10">

        <ArtisteLogo
          size={48}
          subtitle="THE INDIAN ART HOUSE · MY ART GALLERY"
        />

        <nav
          className="hidden items-center gap-8 text-[10px] font-bold uppercase tracking-[.17em] text-[#53615A] md:flex"
          aria-label="Main navigation"
        >
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="site-nav-link hover:text-[#B85D3B]"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">

          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#D9C6A6] text-[#263832] md:hidden"
            aria-label={
              mobileOpen
                ? 'Close navigation'
                : 'Open navigation'
            }
            aria-expanded={mobileOpen}
          >
            {mobileOpen
              ? <X size={18} />
              : <Menu size={18} />
            }
          </button>

          <button
            type="button"
            onClick={openCart}
            className="inline-flex items-center gap-2 rounded-full border border-[#C69C6D]/70 bg-[#F3ECE1] px-3.5 py-2.5 text-[9px] font-bold uppercase tracking-[.13em] text-[#263832] transition hover:-translate-y-0.5 hover:border-[#B85D3B] hover:text-[#B85D3B] sm:px-4"
          >
            <ShoppingBag size={15} strokeWidth={1.8} />
            <span>Cart</span>
          </button>

          {/* PROFILE MENU */}

          <div
            className="relative"
            ref={menuRef}
          >

            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[#C69C6D] bg-[#F3ECE1] text-[#263832] shadow-sm transition hover:ring-4 hover:ring-[#C69C6D]/20"
              aria-label="Open profile menu"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              {identity?.avatar ? (
                <img
                  src={identity.avatar}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : identity ? (
                <span className="font-serif text-sm font-semibold">
                  {initials(identity.name)}
                </span>
              ) : (
                <CircleUserRound
                  size={23}
                  strokeWidth={1.45}
                />
              )}
            </button>

            {profileOpen && (
              <div
                className="profile-menu absolute right-0 top-[calc(100%+12px)] z-[70] w-[min(300px,calc(100vw-28px))] overflow-hidden rounded-2xl border border-[#D9C6A6] bg-[#FAF6F0] py-2"
                role="menu"
              >

                {identity ? (
                  <>

                    <div className="flex items-center gap-3 border-b border-[#D9C6A6]/70 px-4 pb-3 pt-2">

                      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#C69C6D] bg-[#F3ECE1]">

                        {identity.avatar ? (
                          <img
                            src={identity.avatar}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="font-serif text-sm font-semibold">
                            {initials(identity.name)}
                          </span>
                        )}

                      </span>

                      <span className="min-w-0">

                        <b className="block truncate text-sm text-[#263832]">
                          {identity.name}
                        </b>

                        <small className="mt-1 block text-[9px] uppercase tracking-[.15em] text-[#8A7864]">
                          {identity.kind === 'creator'
                            ? (
                              identity.creatorRole === 'Photographer'
                                ? 'Photographer'
                                : 'Painter'
                            )
                            : 'Customer account'}
                        </small>

                      </span>

                    </div>

                    <div className="py-1">

                      {(identity.kind === 'creator'
                        ? creatorLinks
                        : customerLinks
                      ).map(({ label, href, icon: Icon }) => (
                        <Link
                          key={label}
                          href={href}
                          role="menuitem"
                          onClick={() => setProfileOpen(false)}
                          className="flex items-center gap-3 px-4 py-3 text-xs font-medium text-[#45534B] transition hover:bg-[#F3ECE1] hover:text-[#B85D3B]"
                        >
                          <Icon
                            size={15}
                            strokeWidth={1.7}
                          />

                          {label}
                        </Link>
                      ))}

                    </div>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={signOut}
                      className="flex w-full items-center gap-3 border-t border-[#D9C6A6]/70 px-4 py-3 text-left text-xs font-semibold text-[#B85D3B] transition hover:bg-[#F3ECE1]"
                    >
                      <LogOut size={15} />
                      Log Out
                    </button>

                  </>
                ) : (
                  <>

                    <p className="px-4 pb-2 pt-2 text-[9px] font-bold uppercase tracking-[.18em] text-[#8A7864]">
                      Welcome to Artiste
                    </p>

                    <Link
                      href="/account"
                      role="menuitem"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 text-xs font-semibold text-[#45534B] transition hover:bg-[#F3ECE1] hover:text-[#B85D3B]"
                    >
                      <UserRound size={15} />
                      Customer Sign In / Sign Up
                    </Link>

                    <Link
                      href="/artist"
                      role="menuitem"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 text-xs font-semibold text-[#45534B] transition hover:bg-[#F3ECE1] hover:text-[#B85D3B]"
                    >
                      <Store size={15} />
                      Painter &amp; Photographer Portal
                    </Link>

                  </>
                )}

              </div>
            )}

          </div>

        </div>
      </div>

      {mobileOpen && (
        <nav
          className="border-t border-[#D9C6A6]/70 bg-[#FAF6F0] px-5 py-3 md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-1">

            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-xl px-3 py-3 text-[10px] font-bold uppercase tracking-[.14em] text-[#45534B] transition hover:bg-[#F3ECE1] hover:text-[#B85D3B]"
              >
                {link.label}
              </Link>
            ))}

          </div>
        </nav>
      )}

    </header>
  );
}
