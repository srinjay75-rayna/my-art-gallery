"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Landmark,
  LogOut,
  MapPin,
  Palette,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  clearPortalSession,
  getPortalSession,
  portalFetch,
  subscribePortalSession,
} from '@/lib/client-auth';
import EmailOtpAuth from '@/components/EmailOtpAuth';
import IndianAddressForm from '@/components/IndianAddressForm';
import FoundingArtistApplication from '@/components/FoundingArtistApplication';

const ArtistPrivateEarnings = dynamic(
  () => import('@/components/ArtistPrivateEarnings'),
  { ssr: false, loading: () => null }
);

const money = (value) => new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
}).format(Number(value || 0));

const emptyPickup = {
  full_name: '',
  phone: '',
  address: '',
  landmark: '',
  locality: '',
  city: '',
  state: '',
  pincode: '',
};

const artworkBlank = {
  category: 'Painting',
  title: '',
  medium: '',
  dimensions: '',
  description: '',
  framed_status: 'Unframed',
  price: '',
  stock_quantity: '1',
  edition_details: '',
  print_details: '',
  weight_kg: '0.5',
  length_cm: '',
  breadth_cm: '',
  height_cm: '',
};

const payoutBlank = {
  account_holder_name: '',
  bank_account_number: '',
  confirm_bank_account_number: '',
  ifsc_code: '',
  upi_id: '',
};

export default function ArtistPage() {
  const router = useRouter();

  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileChecking, setProfileChecking] = useState(false);
  const [artist, setArtist] = useState(null);

  const [profile, setProfile] = useState({
    artist_name: '',
    creator_role: 'Painter',
    bio: '',
    city: '',
    state: '',
    pickup_location: 'Primary',
  });

  const [pickup, setPickup] = useState(emptyPickup);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState('');

  const [payoutForm, setPayoutForm] = useState(payoutBlank);
  const [payoutAccount, setPayoutAccount] = useState(null);
  const [verifiedIfsc, setVerifiedIfsc] = useState(null);

  const [artworks, setArtworks] = useState([]);
  const [ledger, setLedger] = useState([]);

  const [form, setForm] = useState(artworkBlank);
  const [photos, setPhotos] = useState([]);
  const [materialCost, setMaterialCost] = useState('0');
  const [hoursWorked, setHoursWorked] = useState('0');
  const [hourlyRate, setHourlyRate] = useState('500');
  const [additionalOverheads, setAdditionalOverheads] = useState('0');
  const [marginMultiplier, setMarginMultiplier] = useState('2.5');
  const [editingPaintingId, setEditingPaintingId] = useState(null);
  const [paintingEditForm, setPaintingEditForm] = useState({});
  const [paintingEditPhotos, setPaintingEditPhotos] = useState([]);
  const [paintingEditGalleryImages, setPaintingEditGalleryImages] = useState([]);
  const [selectedStudioImages, setSelectedStudioImages] = useState({});

  const [busy, setBusy] = useState(false);
  const [ifscBusy, setIfscBusy] = useState(false);

  const [editingDetails, setEditingDetails] = useState(false);
  const [editingPayout, setEditingPayout] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Primitive identity key: getPortalSession() returns a fresh object on each read.
  // Never use that object itself as an effect dependency.
  const sessionToken = session?.access_token || '';
  const sessionUserId = session?.user?.id || '';
  const sessionAccountType =
    session?.accountType || session?.user?.user_metadata?.account_type || '';
  const sessionCreatorRole =
    session?.creatorRole || session?.user?.user_metadata?.creator_role || '';

  const studioSessionKey =
    sessionToken && sessionUserId && sessionAccountType === 'artist'
      ? `${sessionAccountType}:${sessionCreatorRole}:${sessionUserId}:${sessionToken}`
      : '';

  const studioLoadKeyRef = useRef('');

  /* ==========================================
     UNIFIED SIGNED PORTAL AUTHENTICATION

     Supports:
     - artiste_portal_session HTTP-only cookie
     - Custom HMAC-signed Bearer token
     - Separate Customer and Artist sessions
     - Separate Painter and Photographer identities
  ========================================== */

  useEffect(() => {
    let active = true;

    const syncPortalSession = () => {
      if (!active) return;

      const value = getPortalSession('artist');

      setSession(value);
      setAuthLoading(false);

      if (!value) {
        setArtist(null);
        setArtworks([]);
        setLedger([]);
        setPayoutAccount(null);
        setPayoutForm(payoutBlank);
        setVerifiedIfsc(null);
      }
    };

    syncPortalSession();

    const unsubscribe = subscribePortalSession(syncPortalSession);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  /* ==========================================
     DISCIPLINE DEFAULTS
  ========================================== */

  useEffect(() => {
    if (!artist) return;
    setForm((current) => current.title || current.medium || current.price
      ? current
      : { ...current, category: 'Painting' });
  }, [artist?.id]);

  /* ==========================================
     PRIVATE ARTIST PAYOUT CALCULATIONS
     Rendered only inside the authenticated Creator Studio.
  ========================================== */

  const payoutRate = artist?.is_founding_artist ? 0.80 : 0.70;
  const platformRate = 1 - payoutRate;

  const suggestedBasePrice = Math.ceil(
    (Math.max(0, Number(materialCost) || 0) +
      Math.max(0, Number(hoursWorked) || 0) * Math.max(0, Number(hourlyRate) || 0) +
      Math.max(0, Number(additionalOverheads) || 0)) *
      Math.max(0, Number(marginMultiplier) || 0)
  );
  const recommendedListingPrice = suggestedBasePrice;
  const artistNetPreview = recommendedListingPrice * payoutRate;
  const platformSharePreview = recommendedListingPrice * (1 - payoutRate);

  /* ==========================================
     UNIFIED AUTHENTICATED API HELPER
  ========================================== */

  async function api(url, options = {}) {
    const response = await portalFetch(url, {
      ...options,
      cache: 'no-store',
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        clearPortalSession();
      }

      throw new Error(data.error || 'Request failed.');
    }

    return data;
  }

  /* ==========================================
     LOAD ARTIST PROFILE AND STUDIO DATA
  ========================================== */

  async function loadArtistStudio(
    showInlineLoading = false,
    shouldApply = () => true
  ) {
    if (!session || !shouldApply()) return;

    if (showInlineLoading) {
      setProfileChecking(true);
    }

    try {
      const data = await api('/api/artist/profile');

      if (!shouldApply()) return;

      setArtist(data.artist || null);
      setLedger(data.ledger || []);

      setForm((current) => current.title || current.medium || current.price
        ? current
        : { ...current, category: 'Painting' });

      const complete = Boolean(
        data.artist?.artist_name &&
        data.artist?.bio &&
        data.artist?.pickup_address &&
        data.artist?.pickup_phone &&
        data.artist?.whatsapp_number &&
        data.artist?.email &&
        data.artist?.pickup_locality &&
        data.artist?.city &&
        data.artist?.state &&
        /^\d{6}$/.test(
          String(data.artist?.pickup_pincode || '')
        )
      );

      // INCOMPLETE PROFILE: open inline editor instead of redirecting.
      if (!complete) {
        setEditingDetails(true);
      } else {
        setEditingDetails(false);
      }

      setEditingPayout(false);

      setPayoutAccount(data.payoutAccount || null);

      if (data.payoutAccount) {
        setPayoutForm({
          ...payoutBlank,
          account_holder_name:
            data.payoutAccount.account_holder_name || '',
          ifsc_code:
            data.payoutAccount.ifsc_code || '',
          upi_id:
            data.payoutAccount.upi_id || '',
        });

        setVerifiedIfsc({
          bank_name: data.payoutAccount.bank_name,
          branch_name: data.payoutAccount.branch_name,
          ifsc: data.payoutAccount.ifsc_code,
        });
      }

      if (data.artist) {
        const a = data.artist;

        setProfile({
          artist_name: a.artist_name || '',
          creator_role:
            a.creator_role === 'Photographer'
              ? 'Photographer'
              : 'Painter',
          bio: a.bio || '',
          city: a.city || '',
          state: a.state || '',
          pickup_location: a.pickup_location || 'Primary',
          instagram_handle: a.instagram_handle || '',
          whatsapp_number: a.whatsapp_number || a.phone || '',
        });

        setPickup({
          full_name:
            a.pickup_contact_name || a.artist_name || '',
          phone: a.pickup_phone || '',
          address: a.pickup_address || '',
          landmark: a.pickup_landmark || '',
          locality: a.pickup_locality || '',
          city: a.city || '',
          state: a.state || '',
          pincode: a.pickup_pincode || '',
        });

        const paintings = await api('/api/artist/paintings');

        if (!shouldApply()) return;

        setArtworks(paintings.paintings || []);
      }
    } finally {
      if (showInlineLoading && shouldApply()) {
        setProfileChecking(false);
      }
    }
  }

  /* ==========================================
     LOAD DASHBOARD AFTER AUTHENTICATION

     Primitive session key + ref prevent repeated loads.
  ========================================== */

  useEffect(() => {
    if (!studioSessionKey) {
      studioLoadKeyRef.current = '';

      setArtist(null);
      setArtworks([]);
      setLedger([]);
      setPayoutAccount(null);
      setPayoutForm(payoutBlank);
      setVerifiedIfsc(null);
      setProfileChecking(false);

      return;
    }

    if (studioLoadKeyRef.current === studioSessionKey) return;

    studioLoadKeyRef.current = studioSessionKey;

    const isCurrentLoad = () =>
      studioLoadKeyRef.current === studioSessionKey;

    setError('');

    loadArtistStudio(true, isCurrentLoad).catch((err) => {
      if (isCurrentLoad()) {
        setError(err.message);
      }
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioSessionKey, router]);

  /* ==========================================
     HASH NAVIGATION
  ========================================== */

  useEffect(() => {
    if (
      !authLoading &&
      artist &&
      typeof window !== 'undefined' &&
      window.location.hash
    ) {
      const targetId = window.location.hash.slice(1);

      window.requestAnimationFrame(() => {
        document
          .getElementById(targetId)
          ?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
          });
      });
    }
  }, [authLoading, artist]);

  /* ==========================================
     PROFILE PHOTO PREVIEW
  ========================================== */

  useEffect(() => {
    if (!profilePhoto) {
      setProfilePhotoPreview('');
      return undefined;
    }

    const url = URL.createObjectURL(profilePhoto);

    setProfilePhotoPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [profilePhoto]);

  /* ==========================================
     SAVE ARTIST PROFILE
  ========================================== */

  async function saveProfile(event) {
    event.preventDefault();

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const data = new FormData();

      Object.entries(profile).forEach(([key, value]) => {
        data.append(key, value);
      });

      data.append('pickup_address', pickup.address);
      data.append('pickup_contact_name', pickup.full_name);
      data.append('pickup_phone', pickup.phone);
      data.append('pickup_landmark', pickup.landmark);
      data.append('pickup_locality', pickup.locality);
      data.append('pickup_pincode', pickup.pincode);

      if (profilePhoto) {
        data.append('photo', profilePhoto);
      }

      const result = await api('/api/artist/profile', {
        method: 'POST',
        body: data,
      });

      setArtist(result.artist);

      setForm((current) => ({
        ...current,
        category:
          result.artist?.creator_role === 'Photographer'
            ? 'Photography'
            : 'Painting',
      }));

      setProfilePhoto(null);
      setNotice(result.message);

      await loadArtistStudio(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* ==========================================
     VERIFY IFSC
  ========================================== */

  async function verifyIFSC() {
    const ifsc = payoutForm.ifsc_code.trim().toUpperCase();

    setIfscBusy(true);
    setError('');
    setVerifiedIfsc(null);

    try {
      const result = await api(
        `/api/artist/verify-ifsc?ifsc=${encodeURIComponent(ifsc)}`
      );

      setVerifiedIfsc(result);

      setPayoutForm((current) => ({
        ...current,
        ifsc_code: result.ifsc,
      }));

      setNotice(
        `Verified: ${result.bank_name}, ${result.branch_name}.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setIfscBusy(false);
    }
  }

  /* ==========================================
     SAVE PAYOUT DETAILS
  ========================================== */

  async function savePayout(event) {
    event.preventDefault();

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const result = await api('/api/artist/payout-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payoutForm),
      });

      setPayoutAccount(result.account);

      setPayoutForm((current) => ({
        ...payoutBlank,
        account_holder_name: current.account_holder_name,
        ifsc_code: current.ifsc_code,
        upi_id: current.upi_id,
      }));

      setVerifiedIfsc({
        ifsc: result.account.ifsc_code,
        bank_name: result.account.bank_name,
        branch_name: result.account.branch_name,
      });

      setNotice(result.message);

      await loadArtistStudio(false);

      setEditingPayout(false);
      setEditingDetails(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* ==========================================
     UPLOAD NEW ARTWORK
  ========================================== */

  async function uploadArtwork(event) {
    event.preventDefault();

    const photoLimit = form.category === 'Photography' ? 2 : 4;

    if (photos.length < 1 || photos.length > photoLimit) {
      setError(
        `Choose between 1 and ${photoLimit} photos for this ${form.category === 'Photography' ? 'Fine-Art Photography' : 'Original Painting'}.`
      );
      return;
    }

    if (artist?.is_suspended) {
      setError(
        'Your Artist account is suspended. Please contact Artiste support.'
      );
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      const artistProfile = artist;

      if (!artistProfile?.id) {
        throw new Error(
          'Your Artist profile could not be verified. Refresh the portal and try again.'
        );
      }

      const data = new FormData();

      Object.entries(form).forEach(([key, value]) => {
        data.append(key, value);
      });

      data.append('artist_id', artistProfile.id);

      photos.forEach((file) => {
        data.append('photos', file);
      });

      const result = await api('/api/artist/paintings', {
        method: 'POST',
        body: data,
      });

      setNotice(result.message);

      setForm({
        ...artworkBlank,
        category: 'Painting',
      });

      setPhotos([]);

      const photoInput = document.getElementById(
        'artist-painting-photo'
      );

      if (photoInput) {
        photoInput.value = '';
      }

      await loadArtistStudio(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /* ==========================================
     UPDATE STOCK QUANTITY
  ========================================== */

  async function updateStock(painting, quantity) {
    const next = Number(quantity);

    if (
      !Number.isInteger(next) ||
      next < 0 ||
      next > 10000
    ) {
      setError(
        'Stock quantity must be a whole number from 0 to 10,000.'
      );
      return;
    }

    const previous = artworks.find(
      (item) => item.id === painting.id
    );

    setError('');
    setNotice('');

    setArtworks((current) =>
      current.map((item) =>
        item.id === painting.id
          ? {
              ...item,
              stock_quantity: next,
              is_sold: next === 0,
            }
          : item
      )
    );

    try {
      await api(`/api/artist/paintings/${painting.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stock_quantity: next,
        }),
      });

      setNotice(
        next > 0
          ? 'Stock updated. This listing is available again.'
          : 'Listing withdrawn / delisted. Stock is zero.'
      );
    } catch (err) {
      if (previous) {
        setArtworks((current) =>
          current.map((item) =>
            item.id === painting.id ? previous : item
          )
        );
      }

      setError(err.message);
    }
  }

  /* ==========================================
     DELETE ARTWORK LISTING
  ========================================== */

  async function remove(painting) {
    if (!confirm(`Delete “${painting.title}”?`)) {
      return;
    }

    const previous = artworks;

    setArtworks((current) =>
      current.filter((item) => item.id !== painting.id)
    );

    try {
      await api(`/api/artist/paintings/${painting.id}`, {
        method: 'DELETE',
      });

      setNotice('Artwork deleted from your studio.');
    } catch (err) {
      setArtworks(previous);
      setError(err.message);
    }
  }

  /* ==========================================
     SAVE ARTWORK DETAILS
  ========================================== */

  async function savePaintingDetails(event, painting) {
    event.preventDefault();

    const before = painting;
    const draft = paintingEditForm;
    const optimistic = { ...painting, ...draft };

    setArtworks((current) =>
      current.map((item) =>
        item.id === painting.id ? optimistic : item
      )
    );

    setError('');
    setNotice('');

    const data = new FormData();

    Object.entries(draft).forEach(([key, value]) => {
      data.set(key, String(value ?? ''));
    });

    data.set(
      'gallery_images',
      JSON.stringify(paintingEditGalleryImages)
    );

    paintingEditPhotos.forEach((file) => {
      data.append('photos', file);
    });

    try {
      const result = await api(
        `/api/artist/paintings/${painting.id}`,
        {
          method: 'PATCH',
          body: data,
        }
      );

      setArtworks((current) =>
        current.map((item) =>
          item.id === painting.id ? result.painting : item
        )
      );

      setPaintingEditPhotos([]);
      setEditingPaintingId(null);
      setNotice('Artwork details saved.');
    } catch (err) {
      setArtworks((current) =>
        current.map((item) =>
          item.id === painting.id ? before : item
        )
      );

      setError(err.message);
    }
  }

  function beginPaintingEdit(painting) {
    setEditingPaintingId(painting.id);

    setPaintingEditForm({
      title: painting.title || '',
      description: painting.description || '',
      medium: painting.medium || '',
      dimensions: painting.dimensions || '',
      framed_status: painting.framed_status || 'Unframed',
      price: String(painting.price || ''),
    });

    setPaintingEditPhotos([]);

    setPaintingEditGalleryImages(
      Array.isArray(painting.gallery_images) &&
      painting.gallery_images.length
        ? [...painting.gallery_images]
        : [painting.image_url].filter(Boolean)
    );
  }

  /* ==========================================
     SIGN OUT
  ========================================== */

  async function logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
    } catch {
      // Clear local credentials even if the logout request cannot reach the server.
    } finally {
      clearPortalSession();

      setSession(null);
      setArtist(null);
      setArtworks([]);
      setLedger([]);
      setPayoutAccount(null);
      setPayoutForm(payoutBlank);
      setVerifiedIfsc(null);

      setNotice('You have been signed out.');
    }
  }

  /* ==========================================
     DISPLAY VALUES
  ========================================== */

  const avatarUrl =
    profilePhotoPreview ||
    artist?.avatar_url ||
    artist?.profile_photo_url ||
    '';

  const addressLine = [
    artist?.pickup_address,
    artist?.pickup_landmark,
    artist?.pickup_locality,
    artist?.city,
    artist?.state,
    artist?.pickup_pincode,
  ].filter(Boolean).join(', ');

  const isSuspended = Boolean(artist?.is_suspended);

  /* ==========================================
     AUTHENTICATION LOADING SCREEN
  ========================================== */

  if (authLoading) {
    return (
      <main className="paper-grain min-h-screen px-5 py-16">
        <div className="mx-auto max-w-3xl rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-10 text-center">
          <ShieldCheck
            size={28}
            className="mx-auto text-clay"
          />

          <h1 className="mt-3 font-display text-2xl">
            Securing your Artist Portal…
          </h1>
        </div>
      </main>
    );
  }

  /* ==========================================
     COMPLETE ARTIST DASHBOARD
  ========================================== */

  return (
    <main className="paper-grain min-h-screen px-5 py-8 md:px-10">
      <div className="mx-auto max-w-6xl">

        <div className="mb-8 flex justify-end">
          <a
            href="/#gallery"
            className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-clay"
          >
            <ArrowLeft size={14} />
            Back to Collection
          </a>
        </div>

        <p className="eyebrow flex items-center gap-2">
          <Palette size={14} />
          For Artists — Painters &amp; Photographers
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-4">

          {session && (
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-[#e9d8c4] bg-[#f1e8dc] shadow-soft">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={`${artist?.artist_name || 'Artist'} profile`}
                  className="h-full w-full rounded-full object-cover"
                />
              ) : (
                <span className="font-display text-3xl text-clay">
                  A
                </span>
              )}
            </div>
          )}

          <div>
            <h1 className="max-w-4xl font-display text-5xl leading-tight md:text-6xl">
              You Paint the Story. We Value Every Brushstroke—And Only Earn When You Do.
            </h1>

            <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
              Stop underpricing your hours of effort or paying upfront gallery fees. Tell us the exact amount you want in your bank account—we honor your craft, tell the emotional story behind your canvas, and handle buyer trust, insured doorstep shipping, and marketing at ₹0 upfront cost.
            </p>

            <div className="mt-4 grid max-w-4xl gap-2 text-xs leading-5 text-[#53615A] sm:grid-cols-2">
              <p>✓ Aligned Success (You Earn, We Earn — ₹0 Listing Fees)</p>
              <p>✓ Your Effort &amp; Story Properly Valued</p>
              <p>✓ Instant Collector Trust &amp; Official Certificate of Authenticity</p>
              <p>✓ Doorstep Courier Pickup Straight From Your Studio</p>
            </div>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-6 rounded-xl bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="mt-6 rounded-xl bg-green-50 p-3 text-sm text-green-800"
          >
            {notice}
          </p>
        )}

        {!session ? (
          <div className="mt-8 max-w-xl">
            <EmailOtpAuth accountType="artist" />
          </div>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Verified Creator account{' '}
                <b className="text-ink">
                  {session.user.email}
                </b>
              </p>

              <button
                onClick={logout}
                className="action-btn inline-flex items-center gap-2"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>

            {profileChecking && !artist && (
              <div className="mt-5 rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-5 text-sm text-muted">
                Loading your Artist studio…
              </div>
            )}

            {artist && (
              <>
                {isSuspended && (
                  <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                    <b>
                      Your Artist studio is currently suspended.
                    </b>

                    <p className="mt-1 text-xs leading-5">
                      Your existing records remain safe, but you
                      cannot publish or sell artworks while the studio
                      is suspended. Please contact Artiste support
                      for assistance.
                    </p>
                  </div>
                )}

                <div className="mt-7 grid items-start gap-7 lg:grid-cols-[.9fr_1.1fr]">

                  {/* ARTWORK UPLOAD STUDIO */}

                  <section className="rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft md:p-7">

                    <p className="eyebrow flex items-center gap-2">
                      <Palette size={13} />

                      Artist Studio •{' '}
                      {artist?.is_founding_artist
                        ? 'Founding Artist · 80% Artist Share'
                        : 'Standard Artist · 70% Artist Share'}
                    </p>

                    <h2 className="mt-2 font-display text-3xl">
                      List an Artwork
                    </h2>

                    <p className="mt-2 text-xs leading-5 text-muted">
                      Your verified{' '}
                      {artist?.creator_role === 'Photographer'
                        ? 'Photographer'
                        : 'Artist'}{' '}
                      studio can publish original paintings and
                      fine-art photography directly to the Artiste gallery.
                    </p>

                    {isSuspended && (
                      <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-800">
                        Publishing is disabled while your account is suspended.
                      </p>
                    )}

                    <form
                      onSubmit={uploadArtwork}
                      className="mt-5 grid gap-3"
                    >

                      <label className="label">
                        Art Form / Discipline

                        <select
                          className="field mt-1"
                          value={form.category}
                          onChange={(e) => setForm({
                            ...form,
                            category: e.target.value,
                          })}
                        >
                          <option value="Painting">
                            Original Painting
                          </option>

                          <option value="Photography">
                            Fine-Art Photography
                          </option>
                        </select>
                      </label>

                      <label className="label">
                        {form.category === 'Photography'
                          ? 'Photograph file'
                          : 'Artwork photo'}

                        <input
                          id="artist-painting-photo"
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/avif"
                          multiple
                          required
                          onChange={(e) => setPhotos(
                            Array.from(e.target.files || []).slice(
                              0,
                              form.category === 'Photography' ? 2 : 4
                            )
                          )}
                          className="mt-2 block w-full text-xs"
                        />

                        <small className="mt-1 block text-muted">
                          {photos.length} selected ·{' '}
                          {form.category === 'Photography'
                            ? 'maximum 2 photos'
                            : 'maximum 4 photos'}
                        </small>
                      </label>

                      {[
                        ['title', 'Title'],
                        [
                          'medium',
                          form.category === 'Photography'
                            ? 'Photographic process / medium'
                            : 'Medium',
                        ],
                        ['dimensions', 'Artwork dimensions'],
                      ].map(([name, label]) => (
                        <label className="label" key={name}>
                          {label}

                          <input
                            className="field mt-1"
                            value={form[name]}
                            onChange={(e) => setForm(
                              (current) => ({
                                ...current,
                                [name]: e.target.value,
                              })
                            )}
                            required
                            maxLength={
                              name === 'title' ? 120 : 100
                            }
                          />
                        </label>
                      ))}

                      <label className="label">
                        Artwork story / description

                        <textarea
                          className="field mt-1 min-h-24"
                          maxLength={3000}
                          value={form.description}
                          onChange={(e) => setForm((current) => ({
                            ...current,
                            description: e.target.value,
                          }))}
                          placeholder="Share the feeling, process and story behind this work."
                        />
                      </label>

                      <label className="label">
                        Framed / Unframed

                        <select
                          className="field mt-1"
                          value={form.framed_status}
                          onChange={(e) => setForm((current) => ({
                            ...current,
                            framed_status: e.target.value,
                          }))}
                        >
                          <option>Unframed</option>
                          <option>Framed</option>
                        </select>
                      </label>

                      {/* PRIVATE MATERIAL + HOURS PRICE CALCULATOR */}
                      <section className="rounded-2xl border border-[#D9C6A6] bg-[#FAF6F0] p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div><p className="eyebrow">Private Creator Studio calculator</p><h3 className="mt-1 font-display text-xl">Material + Hours Pricing</h3></div>
                          <span className="pill">{artist?.is_founding_artist ? 'Founding Artist · 80% share' : 'Standard Artist · 70% share'}</span>
                        </div>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                          <label className="label">Material / Production Cost (₹)<input className="field mt-1" type="number" min="0" step="1" value={materialCost} onChange={(e) => setMaterialCost(e.target.value)} /></label>
                          <label className="label">Hours Worked<input className="field mt-1" type="number" min="0" step="0.5" value={hoursWorked} onChange={(e) => setHoursWorked(e.target.value)} /></label>
                          <label className="label">Suggested Hourly Rate (₹/hr)<input className="field mt-1" type="number" min="0" step="1" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} /></label>
                          <label className="label">Additional Overheads (₹)<input className="field mt-1" type="number" min="0" step="1" value={additionalOverheads} onChange={(e) => setAdditionalOverheads(e.target.value)} /></label>
                          <label className="label sm:col-span-2">Profit Margin Multiplier<input className="field mt-1" type="number" min="0.1" max="20" step="0.1" value={marginMultiplier} onChange={(e) => setMarginMultiplier(e.target.value)} /><small className="text-muted">Default 2.5x · editable by the artist</small></label>
                        </div>
                        <p className="mt-3 text-xs text-muted">Suggested Base Price = Math.ceil((Material + (Hours × Hourly Rate) + Overheads) × Margin Multiplier)</p>
                        <div className="mt-4 rounded-2xl bg-[#173D31] p-5 text-[#F5F1E8]">
                          <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#D0B48C]">PRIVATE PAYOUT PREVIEW</p>
                          <div className="mt-3 grid gap-4 sm:grid-cols-3">
                            <div><p className="text-[10px] uppercase tracking-wider text-[#C6D3CA]">Artist Share ({Math.round(payoutRate*100)}%)</p><p className="mt-1 font-display text-2xl">{money(artistNetPreview)}</p></div>
                            <div><p className="text-[10px] uppercase tracking-wider text-[#C6D3CA]">Platform Share</p><p className="mt-1 font-display text-2xl">{money(platformSharePreview)}</p></div>
                            <div><p className="text-[10px] uppercase tracking-wider text-[#C6D3CA]">Suggested Base Price</p><p className="mt-1 font-display text-2xl">{money(suggestedBasePrice)}</p></div>
                          </div>
                          <p className="mt-4 border-t border-white/15 pt-3 text-xs leading-5 text-[#E2E9E3]">Private estimate only. Never shown on public artwork pages or customer invoices.</p>
                        </div>
                        <div className="mt-3 flex justify-end"><button type="button" onClick={() => setForm((current) => ({...current, price: String(suggestedBasePrice)}))} className="btn-secondary">Apply Suggested Price</button></div>
                      </section>

                      {/* LISTING PRICE */}

                      <label className="label">
                        Listing Price (INR)

                        <input
                          className="field mt-1"
                          value={form.price}
                          onChange={(e) => setForm((current) => ({
                            ...current,
                            price: e.target.value,
                          }))}
                          required
                          type="number"
                          min="1"
                          step="0.01"
                        />

                        <small className="text-muted">
                          Apply the recommended amount or enter any custom listing price.
                        </small>
                      </label>

                      {/* STOCK, EDITION AND PRINT DETAILS */}

                      {[
                        [
                          'stock_quantity',
                          form.category === 'Photography'
                            ? 'Available print quantity'
                            : 'Stock quantity',
                        ],
                        [
                          'edition_details',
                          'Edition details (optional)',
                        ],
                        [
                          'print_details',
                          'Print / paper details (optional)',
                        ],
                        [
                          'weight_kg',
                          'Packed weight (kg)',
                        ],
                      ].map(([name, label]) => (
                        <label className="label" key={name}>
                          {label}

                          <input
                            className="field mt-1"
                            value={form[name]}
                            onChange={(e) => setForm((current) => ({
                              ...current,
                              [name]: e.target.value,
                            }))}
                            required={
                              name === 'stock_quantity' ||
                              name === 'weight_kg'
                            }
                            type={
                              ['weight_kg', 'stock_quantity'].includes(name)
                                ? 'number'
                                : 'text'
                            }
                            step={
                              name === 'weight_kg'
                                ? '0.1'
                                : name === 'stock_quantity'
                                  ? '1'
                                  : undefined
                            }
                            min={
                              name === 'weight_kg'
                                ? '0.2'
                                : name === 'stock_quantity'
                                  ? '1'
                                  : undefined
                            }
                            max={
                              name === 'stock_quantity'
                                ? '10000'
                                : undefined
                            }
                          />

                          {name === 'weight_kg' && (
                            <small className="text-muted">
                              Light parcels from 0.2 kg · default 0.5 kg
                            </small>
                          )}

                          {name === 'stock_quantity' && (
                            <small className="text-muted">
                              Set 1 for a one-off original or higher
                              for limited print editions.
                            </small>
                          )}
                        </label>
                      ))}

                      <div className="grid grid-cols-3 gap-2">
                        {[
                          'length_cm',
                          'breadth_cm',
                          'height_cm',
                        ].map((name) => (
                          <label
                            key={name}
                            className="label"
                          >
                            {name.replace('_cm', '')} cm

                            <input
                              className="field mt-1"
                              type="number"
                              min="0.1"
                              step="0.1"
                              required
                              value={form[name]}
                              onChange={(e) => setForm({
                                ...form,
                                [name]: e.target.value,
                              })}
                            />
                          </label>
                        ))}
                      </div>

                      <button
                        disabled={busy || isSuspended}
                        className="btn-primary inline-flex items-center justify-center gap-2"
                      >
                        {busy
                          ? 'Publishing…'
                          : isSuspended
                            ? 'Studio suspended'
                            : 'Publish Artwork'}

                        <ArrowUpRight size={15} />
                      </button>

                    </form>
                  </section>

                  {/* WORKS AND EARNINGS */}

                  <section className="min-w-0">

                    <div className="rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft md:p-7">

                      <p className="eyebrow flex items-center gap-2">
                        <Wallet size={13} />

                        Sales &amp; Payouts •{' '}
                        {artist?.is_founding_artist
                          ? 'Founding Artist · 80% Artist Share'
                          : 'Standard Artist · 70% Artist Share'}
                      </p>

                      <h2
                        id="earnings"
                        className="mt-2 scroll-mt-28 font-display text-3xl"
                      >
                        My Works &amp; Earnings
                      </h2>

                      <div className="mt-5 grid gap-3">

                        {artworks.map((painting) => (
                          <article
                            key={painting.id}
                            className="flex gap-3 rounded-2xl border border-[#D9C6A6] bg-[#F3ECE1] p-3"
                          >

                            <div className="w-24 shrink-0">

                              <img
                                src={selectedStudioImages[painting.id] || painting.image_url}
                                alt={painting.title}
                                className="h-24 w-24 rounded-xl object-cover"
                              />

                              <div className="mt-1 flex gap-1 overflow-x-auto">
                                {(Array.isArray(painting.gallery_images) && painting.gallery_images.length
                                  ? painting.gallery_images
                                  : [painting.image_url]
                                ).map((src, index) => (
                                  <button
                                    key={`${painting.id}-thumb-${index}`}
                                    type="button"
                                    onClick={() => setSelectedStudioImages((current) => ({
                                      ...current,
                                      [painting.id]: src,
                                    }))}
                                    className={`h-7 w-7 shrink-0 overflow-hidden rounded-md border ${
                                      ((selectedStudioImages[painting.id] || painting.image_url) === src)
                                        ? 'border-[#B85D3B]'
                                        : 'border-[#D9C6A6]'
                                    }`}
                                    aria-label={`Show photo ${index + 1} of ${painting.title}`}
                                  >
                                    <img
                                      src={src}
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="min-w-0 flex-1">

                              <h3 className="font-display text-xl">
                                {painting.title}
                              </h3>

                              <p className="text-xs text-muted">
                                {painting.category === 'Photography'
                                  ? 'Fine-Art Photography'
                                  : 'Original Painting'}

                                {' · '}

                                {money(painting.price)}

                                {' · '}

                                {Number(
                                  painting.stock_quantity ??
                                  (painting.is_sold ? 0 : 1)
                                ) <= 0
                                  ? 'SOLD OUT'
                                  : `${Number(painting.stock_quantity ?? 1)} in stock`}

                                {' · '}

                                {painting.is_approved
                                  ? 'Published'
                                  : 'Unpublished by Artiste'}
                              </p>

                              {painting.category === 'Photography' && (
                                <p className="mt-1 text-[10px] text-muted">
                                  {[
                                    painting.edition_details,
                                    painting.print_details,
                                  ].filter(Boolean).join(' · ')}
                                </p>
                              )}

                              <p className="mt-1 text-xs leading-5 text-muted">
                                {painting.description || 'No artwork story added yet.'}
                                {' · '}
                                {painting.framed_status || 'Unframed'}
                              </p>

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="action-btn"
                                  onClick={() =>
                                    editingPaintingId === painting.id
                                      ? setEditingPaintingId(null)
                                      : beginPaintingEdit(painting)
                                  }
                                >
                                  {editingPaintingId === painting.id
                                    ? 'Close editor'
                                    : 'Edit Details'}
                                </button>
                              </div>

                              {editingPaintingId === painting.id && (
                                <form
                                  onSubmit={(event) =>
                                    savePaintingDetails(event, painting)
                                  }
                                  className="mt-3 grid gap-2 rounded-xl border border-[#D9C6A6] bg-[#FAF6F0] p-3"
                                >
                                  <label className="label">
                                    Title

                                    <input
                                      className="field mt-1"
                                      required
                                      maxLength={120}
                                      value={paintingEditForm.title || ''}
                                      onChange={(e) => setPaintingEditForm((current) => ({
                                        ...current,
                                        title: e.target.value,
                                      }))}
                                    />
                                  </label>

                                  <label className="label">
                                    Story / description

                                    <textarea
                                      className="field mt-1 min-h-20"
                                      maxLength={3000}
                                      value={paintingEditForm.description || ''}
                                      onChange={(e) => setPaintingEditForm((current) => ({
                                        ...current,
                                        description: e.target.value,
                                      }))}
                                    />
                                  </label>

                                  <div className="grid gap-2 sm:grid-cols-2">

                                    <label className="label">
                                      Medium

                                      <input
                                        className="field mt-1"
                                        required
                                        maxLength={120}
                                        value={paintingEditForm.medium || ''}
                                        onChange={(e) => setPaintingEditForm((current) => ({
                                          ...current,
                                          medium: e.target.value,
                                        }))}
                                      />
                                    </label>

                                    <label className="label">
                                      Dimensions (inches)

                                      <input
                                        className="field mt-1"
                                        required
                                        maxLength={100}
                                        value={paintingEditForm.dimensions || ''}
                                        onChange={(e) => setPaintingEditForm((current) => ({
                                          ...current,
                                          dimensions: e.target.value,
                                        }))}
                                      />
                                    </label>

                                    <label className="label">
                                      Framed / Unframed

                                      <select
                                        className="field mt-1"
                                        value={paintingEditForm.framed_status || 'Unframed'}
                                        onChange={(e) => setPaintingEditForm((current) => ({
                                          ...current,
                                          framed_status: e.target.value,
                                        }))}
                                      >
                                        <option>Unframed</option>
                                        <option>Framed</option>
                                      </select>
                                    </label>

                                    <label className="label">
                                      Price (₹)

                                      <input
                                        className="field mt-1"
                                        type="number"
                                        min="1"
                                        step="0.01"
                                        required
                                        value={paintingEditForm.price || ''}
                                        onChange={(e) => setPaintingEditForm((current) => ({
                                          ...current,
                                          price: e.target.value,
                                        }))}
                                      />
                                    </label>

                                  </div>

                                  <div className="grid gap-2">

                                    <p className="label">
                                      Current artwork photos · choose which to keep
                                    </p>

                                    <div className="flex flex-wrap gap-2">
                                      {paintingEditGalleryImages.map((src, index) => (
                                        <div
                                          key={`${painting.id}-edit-photo-${index}`}
                                          className="flex items-center gap-2 rounded-lg border border-[#D9C6A6] bg-white p-1.5"
                                        >
                                          <img
                                            src={src}
                                            alt={`Artwork photo ${index + 1}`}
                                            className="h-12 w-12 rounded-md object-cover"
                                          />

                                          <button
                                            type="button"
                                            className="text-[10px] font-semibold text-clay underline"
                                            onClick={() => setPaintingEditGalleryImages((current) =>
                                              current.filter(
                                                (_, imageIndex) => imageIndex !== index
                                              )
                                            )}
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ))}
                                    </div>

                                  </div>

                                  <label className="label">
                                    Add photos (up to {form.category === 'Photography' ? 2 : 4} total)

                                    <input
                                      className="mt-1 block w-full text-xs"
                                      type="file"
                                      multiple
                                      accept="image/jpeg,image/png,image/webp,image/avif"
                                      onChange={(e) => setPaintingEditPhotos(
                                        Array.from(e.target.files || []).slice(
                                          0,
                                          Math.max(
                                            0,
                                            (artist?.creator_role === 'Photographer' ? 2 : 4) -
                                            paintingEditGalleryImages.length
                                          )
                                        )
                                      )}
                                    />
                                  </label>

                                  <p className="text-[10px] text-muted">
                                    {paintingEditGalleryImages.length + paintingEditPhotos.length} photo(s) total after save. Keep at least one photo.
                                  </p>

                                  <button
                                    type="submit"
                                    className="btn-secondary"
                                    disabled={isSuspended}
                                  >
                                    Save Artwork Details
                                  </button>

                                </form>
                              )}

                              {/* STOCK MANAGEMENT */}

                              <div className="mt-3 flex flex-wrap items-center gap-2">

                                <button
                                  type="button"
                                  className="action-btn"
                                  disabled={
                                    busy ||
                                    isSuspended ||
                                    Number(
                                      painting.stock_quantity ??
                                      (painting.is_sold ? 0 : 1)
                                    ) <= 0
                                  }
                                  onClick={() => updateStock(
                                    painting,
                                    Math.max(
                                      0,
                                      Number(painting.stock_quantity ?? 1) - 1
                                    )
                                  )}
                                >
                                  − Stock
                                </button>

                                <input
                                  aria-label={`Stock quantity for ${painting.title}`}
                                  className="field !w-20 !px-2 !py-1 text-center"
                                  type="number"
                                  min="0"
                                  max="10000"
                                  step="1"
                                  value={
                                    painting.stock_quantity ??
                                    (painting.is_sold ? 0 : 1)
                                  }
                                  disabled={busy || isSuspended}
                                  onChange={(event) => setArtworks((current) =>
                                    current.map((item) =>
                                      item.id === painting.id
                                        ? {
                                            ...item,
                                            stock_quantity: event.target.value,
                                          }
                                        : item
                                    )
                                  )}
                                />

                                <button
                                  type="button"
                                  className="action-btn"
                                  disabled={busy || isSuspended}
                                  onClick={() => updateStock(
                                    painting,
                                    painting.stock_quantity
                                  )}
                                >
                                  Save stock
                                </button>

                                <button
                                  type="button"
                                  className="action-btn"
                                  disabled={
                                    busy ||
                                    isSuspended ||
                                    Number(painting.stock_quantity ?? 0) >= 10000
                                  }
                                  onClick={() => updateStock(
                                    painting,
                                    Math.min(
                                      10000,
                                      Number(painting.stock_quantity ?? 0) + 1
                                    )
                                  )}
                                >
                                  + Restock
                                </button>

                                <button
                                  type="button"
                                  className="action-btn"
                                  disabled={
                                    busy ||
                                    isSuspended ||
                                    Number(painting.stock_quantity ?? 1) === 0
                                  }
                                  onClick={() => updateStock(painting, 0)}
                                >
                                  Withdraw / Delist
                                </button>

                                <button
                                  type="button"
                                  className="action-btn danger"
                                  disabled={busy}
                                  onClick={() => remove(painting)}
                                >
                                  Delete
                                </button>

                              </div>
                            </div>
                          </article>
                        ))}

                        {!artworks.length && (
                          <p className="rounded-2xl border border-dashed p-7 text-center text-sm text-muted">
                            Your published paintings and fine-art
                            photographs will appear here.
                          </p>
                        )}

                      </div>
                    </div>

                    <ArtistPrivateEarnings
                      ledger={ledger}
                      creatorRole={artist?.creator_role || 'Painter'}
                      isFoundingArtist={Boolean(artist?.is_founding_artist)}
                      showLedger
                    />

                  </section>
                </div>

                <div className="mt-8">
                  <FoundingArtistApplication />
                </div>

                {/* ARTIST PROFILE AND BANK DETAILS */}

                <section
                  id="profile"
                  className="mt-8 scroll-mt-28 rounded-3xl border border-[#D9C6A6] bg-[#F3ECE1] p-6 shadow-soft md:p-8"
                >

                  <div className="flex flex-wrap items-center justify-between gap-3">

                    <div>
                      <p className="eyebrow flex items-center gap-2">
                        <BadgeCheck size={13} />
                        Studio &amp; payout profile
                      </p>

                      <h2 className="mt-2 font-display text-3xl">
                        Your saved Artist details
                      </h2>

                      <p className="mt-1 text-xs leading-5 text-muted">
                        Your studio pickup address and payout destination are private. Bank details are optional and may be added or edited at any time.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setEditingDetails((value) => !value);

                        setEditingPayout(
                          !editingDetails &&
                          Boolean(payoutAccount?.verified_at)
                        );
                      }}
                      className="btn-secondary"
                    >
                      {editingDetails
                        ? 'Close editor'
                        : 'Edit Studio & Bank Details'}
                    </button>

                  </div>

                  {!editingDetails ? (

                    <div className="mt-5 grid gap-4 md:grid-cols-2">

                      {/* STUDIO PICKUP DETAILS */}

                      <div className="rounded-2xl bg-[#F3ECE1] p-4">

                        <div className="flex items-center gap-2 font-semibold">
                          <MapPin size={16} className="text-clay" />
                          Studio pickup
                        </div>

                        <p className="mt-2 text-sm font-semibold">
                          {artist.creator_role === 'Photographer'
                            ? 'Photographer'
                            : 'Artist'}{' '}
                          · {artist.artist_name}
                        </p>

                        <p className="mt-1 text-xs leading-6 text-muted">
                          {addressLine || 'Pickup address not saved'}
                        </p>

                        <p className="mt-1 text-xs text-muted">
                          {artist.pickup_contact_name} · {artist.pickup_phone}
                        </p>

                        <p className="mt-1 text-[10px] text-muted">
                          Shiprocket location: {artist.pickup_location || 'Primary'}
                        </p>

                      </div>

                      {/* VERIFIED BANK / UPI */}

                      <div className="rounded-2xl bg-[#F3ECE1] p-4">

                        <div className="flex items-center gap-2 font-semibold">
                          <Landmark size={16} className="text-clay" />
                          Verified bank / UPI
                        </div>

                        {payoutAccount?.verified_at ? (
                          <>
                            <p className="mt-2 text-sm font-semibold">
                              {payoutAccount.bank_name} · {payoutAccount.branch_name}
                            </p>

                            <p className="mt-1 text-xs leading-6 text-muted">
                              {payoutAccount.account_holder_name} ·{' '}
                              {payoutAccount.bank_account_number_masked} ·{' '}
                              {payoutAccount.ifsc_code}
                            </p>

                            <p className="mt-1 text-xs text-muted">
                              {payoutAccount.upi_id
                                ? `UPI: ${payoutAccount.upi_id}`
                                : 'No UPI ID saved'}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-xs text-muted">
                            Payout details not verified.
                          </p>
                        )}

                      </div>
                    </div>

                  ) : (

                    <div className="mt-5 grid gap-5">

                      {/* CREATOR PROFILE EDITOR */}

                      <form
                        onSubmit={saveProfile}
                        className="rounded-2xl border border-[#eee6db] p-5"
                      >

                        <h3 className="font-display text-2xl">
                          Creator profile &amp; studio pickup
                        </h3>

                        <div className="mt-4 flex flex-wrap items-center gap-4">

                          <label className="group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border-4 border-[#eadbca] bg-[#f5eadc] shadow-soft">

                            {avatarUrl ? (
                              <img
                                src={avatarUrl}
                                alt="Artist profile preview"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="font-display text-3xl text-clay">
                                A
                              </span>
                            )}

                            <span className="absolute inset-x-0 bottom-0 bg-ink/75 py-1 text-center text-[9px] font-bold uppercase tracking-wider text-white">
                              Change photo
                            </span>

                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/avif"
                              onChange={(e) => setProfilePhoto(
                                e.target.files?.[0] || null
                              )}
                              className="sr-only"
                            />

                          </label>

                          <div>
                            <p className="font-semibold">
                              Circular Creator profile photo
                            </p>

                            <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                              Upload a JPG, PNG, WEBP or AVIF image up to
                              6 MB. It appears beside your Artist name
                              in the public gallery.
                            </p>

                            {profilePhoto && (
                              <p className="mt-1 text-xs text-green-700">
                                New photo selected. Save your Artist
                                profile to publish it.
                              </p>
                            )}
                          </div>

                        </div>

                        <div className="mt-5 grid gap-4 md:grid-cols-2">



                          <label className="label">
                            Creator / Studio name

                            <input
                              className="field mt-1"
                              value={profile.artist_name}
                              onChange={(e) => setProfile({
                                ...profile,
                                artist_name: e.target.value,
                              })}
                              required
                              maxLength={100}
                            />
                          </label>

                          <label className="label">
                            Instagram handle

                            <input
                              className="field mt-1"
                              value={profile.instagram_handle || artist?.instagram_handle || ''}
                              onChange={(e) => setProfile({
                                ...profile,
                                instagram_handle: e.target.value,
                              })}
                              placeholder="@yourstudio"
                            />
                          </label>

                          <label className="label">
                            WhatsApp number

                            <input
                              className="field mt-1"
                              value={profile.whatsapp_number || artist?.whatsapp_number || pickup.phone || ''}
                              onChange={(e) => setProfile({
                                ...profile,
                                whatsapp_number: e.target.value,
                              })}
                              placeholder="10-digit mobile number"
                              required
                              inputMode="tel"
                            />
                          </label>

                          <label className="label">
                            Verified email

                            <input
                              className="field mt-1"
                              value={session.user.email || ''}
                              readOnly
                            />
                          </label>

                          <label className="label md:col-span-2">
                            Artist bio

                            <textarea
                              className="field mt-1 min-h-24"
                              value={profile.bio}
                              onChange={(e) => setProfile({
                                ...profile,
                                bio: e.target.value,
                              })}
                              required
                              maxLength={1200}
                              placeholder="Tell collectors about your practice…"
                            />
                          </label>

                        </div>

                        {/* PICKUP ADDRESS */}

                        <div className="mt-5 border-t border-[#eee6db] pt-5">

                          <h4 className="font-display text-xl">
                            Artist pickup address
                          </h4>

                          <div className="mt-3">
                            <IndianAddressForm
                              value={pickup}
                              onChange={(patch) => {
                                setPickup((current) => ({
                                  ...current,
                                  ...patch,
                                }));

                                setProfile((current) => ({
                                  ...current,
                                  ...(patch.city
                                    ? { city: patch.city }
                                    : {}),
                                  ...(patch.state
                                    ? { state: patch.state }
                                    : {}),
                                }));
                              }}
                              showContact
                              addressLabel="Full pickup street address"
                            />
                          </div>

                          <label className="label mt-4 block">
                            Shiprocket pickup location name

                            <input
                              className="field mt-1"
                              value={profile.pickup_location}
                              onChange={(e) => setProfile({
                                ...profile,
                                pickup_location: e.target.value,
                              })}
                              required
                              placeholder="Exact location name in Shiprocket"
                            />
                          </label>

                        </div>

                        <button
                          disabled={busy}
                          className="btn-primary mt-5 inline-flex items-center gap-2"
                        >
                          {busy ? 'Saving studio…' : 'Save Studio Profile'}
                          <ArrowUpRight size={15} />
                        </button>

                      </form>

                      {/* VERIFIED BANK AND UPI PAYOUT DETAILS */}

                      <section className="rounded-2xl border border-[#eee6db] p-5">

                        <div className="flex flex-wrap items-center justify-between gap-3">

                          <div>
                            <h3 className="font-display text-2xl">
                              Optional bank &amp; UPI payout details
                            </h3>

                            <p className="mt-1 text-xs leading-5 text-muted">
                              Bank details are optional. Add or edit them whenever you are ready; account numbers are encrypted and only a masked number is shown here.
                            </p>
                          </div>

                          {payoutAccount?.verified_at && (
                            <span className="pill">
                              IFSC verified
                            </span>
                          )}

                        </div>

                        {payoutAccount?.verified_at && !editingPayout && (
                          <div className="mt-4 rounded-xl bg-[#f4e8d9] p-4 text-sm">

                            <b>
                              {payoutAccount.bank_name} · {payoutAccount.branch_name}
                            </b>

                            <p className="mt-1 text-xs text-muted">
                              {payoutAccount.account_holder_name} ·{' '}
                              {payoutAccount.bank_account_number_masked} ·{' '}
                              {payoutAccount.ifsc_code}

                              {payoutAccount.upi_id
                                ? ` · UPI: ${payoutAccount.upi_id}`
                                : ''}
                            </p>

                            <button
                              type="button"
                              onClick={() => setEditingPayout(true)}
                              className="mt-3 text-xs font-bold text-clay underline"
                            >
                              Update bank / UPI details
                            </button>

                          </div>
                        )}

                        {(!payoutAccount?.verified_at || editingPayout) && (

                          <form
                            onSubmit={savePayout}
                            className="mt-4 grid gap-4 md:grid-cols-2"
                          >

                            <label className="label">
                              Account holder name

                              <input
                                className="field mt-1"
                                required
                                maxLength={120}
                                value={payoutForm.account_holder_name}
                                onChange={(e) => setPayoutForm({
                                  ...payoutForm,
                                  account_holder_name: e.target.value,
                                })}
                              />
                            </label>

                            <label className="label">
                              UPI ID{' '}
                              <span className="normal-case tracking-normal text-muted">
                                (optional)
                              </span>

                              <input
                                className="field mt-1"
                                placeholder="name@bank"
                                value={payoutForm.upi_id}
                                onChange={(e) => setPayoutForm({
                                  ...payoutForm,
                                  upi_id: e.target.value,
                                })}
                              />
                            </label>

                            <label className="label">
                              Bank account number

                              <input
                                className="field mt-1"
                                type="password"
                                inputMode="numeric"
                                autoComplete="off"
                                required
                                pattern="[0-9]{8,20}"
                                value={payoutForm.bank_account_number}
                                onChange={(e) => setPayoutForm({
                                  ...payoutForm,
                                  bank_account_number: e.target.value
                                    .replace(/\D/g, '')
                                    .slice(0, 20),
                                })}
                              />
                            </label>

                            <label className="label">
                              Confirm bank account number

                              <input
                                className="field mt-1"
                                type="password"
                                inputMode="numeric"
                                autoComplete="off"
                                required
                                pattern="[0-9]{8,20}"
                                value={payoutForm.confirm_bank_account_number}
                                onChange={(e) => setPayoutForm({
                                  ...payoutForm,
                                  confirm_bank_account_number: e.target.value
                                    .replace(/\D/g, '')
                                    .slice(0, 20),
                                })}
                              />
                            </label>

                            <div>

                              <label className="label">
                                11-character IFSC code

                                <input
                                  className="field mt-1 uppercase"
                                  maxLength={11}
                                  required
                                  value={payoutForm.ifsc_code}
                                  onChange={(e) => {
                                    setPayoutForm({
                                      ...payoutForm,
                                      ifsc_code: e.target.value
                                        .toUpperCase()
                                        .replace(/[^A-Z0-9]/g, '')
                                        .slice(0, 11),
                                    });

                                    setVerifiedIfsc(null);
                                  }}
                                />
                              </label>

                              <button
                                type="button"
                                onClick={verifyIFSC}
                                disabled={
                                  ifscBusy ||
                                  payoutForm.ifsc_code.length !== 11
                                }
                                className="btn-secondary mt-2 w-full"
                              >
                                {ifscBusy
                                  ? 'Verifying…'
                                  : 'Verify IFSC'}
                              </button>

                            </div>

                            {verifiedIfsc && (
                              <div className="md:col-span-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">

                                <b>Verified bank:</b>{' '}
                                {verifiedIfsc.bank_name} ·{' '}
                                {verifiedIfsc.branch_name}

                                <p className="mt-1 text-xs">
                                  IFSC {verifiedIfsc.ifsc}
                                </p>

                              </div>
                            )}

                            <div className="flex flex-wrap gap-2 md:col-span-2">

                              <button
                                disabled={busy || !verifiedIfsc}
                                className="btn-primary inline-flex items-center gap-2"
                              >
                                {busy
                                  ? 'Saving securely…'
                                  : 'Save verified payout details'}

                                <ArrowUpRight size={15} />
                              </button>

                              {editingPayout && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => setEditingPayout(false)}
                                >
                                  Cancel payout edit
                                </button>
                              )}

                            </div>

                          </form>
                        )}

                      </section>

                    </div>
                  )}

                </section>
              </>
            )}
          </>
        )}

        <p className="mt-14 text-center text-[9px] uppercase tracking-[.2em] text-muted">
          Artiste · Painters &amp; Fine-Art Photographers
        </p>

      </div>
    </main>
  );
}
