"use client";

import { useEffect, useState } from 'react';

const money = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(v || 0));
const emptyForm = { title: '', medium: '', dimensions: '', price: '', length_cm: '', breadth_cm: '', height_cm: '', weight_kg: '' };

export default function AdminPage() {
  const [password, setPassword] = useState('');
  const [loggedIn, setLoggedIn] = useState(false);
  const [paintings, setPaintings] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  async function loadPaintings() {
    const response = await fetch('/api/admin/paintings', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not load paintings.');
    setPaintings(data.paintings || []);
  }

  useEffect(() => {
    let active = true;
    fetch('/api/admin/paintings', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (active) { setPaintings(data.paintings || []); setLoggedIn(true); }
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Login failed.');
      setLoggedIn(true); setPassword(''); await loadPaintings(); setNotice('You are signed in to the studio.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setLoggedIn(false); setPaintings([]); setNotice(''); setError('');
  }

  function updateForm(event) { setForm((prev) => ({ ...prev, [event.target.name]: event.target.value })); }

  async function upload(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (!photo) throw new Error('Please choose a painting photo.');
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) => body.append(key, value));
      body.append('photo', photo);
      const response = await fetch('/api/admin/paintings', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload failed.');
      setForm(emptyForm); setPhoto(null);
      const input = document.getElementById('painting-photo'); if (input) input.value = '';
      await loadPaintings(); setNotice('Artwork uploaded and added to the gallery.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function toggleSold(painting) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/admin/paintings/${painting.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_sold: !painting.is_sold }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not update artwork.');
      await loadPaintings(); setNotice(`${painting.title} marked ${!painting.is_sold ? 'sold' : 'available'}.`);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function removePainting(painting) {
    if (!window.confirm(`Permanently delete “${painting.title}”?`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/admin/paintings/${painting.id}`, { method: 'DELETE' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Delete failed.');
      await loadPaintings(); setNotice('Artwork deleted.');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="paper-grain min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex items-center justify-between"><a href="/" className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">R</span><span><span className="block font-display text-2xl">rangrekha</span><span className="block text-[8px] uppercase tracking-[.25em] text-muted">Artist studio</span></span></a><a href="/" className="text-[10px] font-bold uppercase tracking-[.16em] text-clay">← View gallery</a></header>
        {!loggedIn ? (
          <section className="mx-auto max-w-md rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-8 shadow-soft sm:p-10"><p className="text-[10px] font-bold uppercase tracking-[.22em] text-clay">Private workspace</p><h1 className="mt-3 font-display text-4xl">Studio access</h1><p className="mt-3 text-sm leading-6 text-muted">Sign in to upload new work and manage availability in the public gallery.</p><form onSubmit={login} className="mt-8"><label className="label" htmlFor="admin-password">Admin password</label><input id="admin-password" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required/><button disabled={busy} className="btn-primary mt-5 w-full">{busy ? 'Signing in…' : 'Enter studio'} <span>↗</span></button></form>{error && <p className="mt-4 rounded-lg bg-[#f9e8e3] p-3 text-xs text-[#9a3d2c]">{error}</p>}</section>
        ) : (
          <>
            <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-[10px] font-bold uppercase tracking-[.22em] text-clay">Manage your collection</p><h1 className="mt-2 font-display text-5xl tracking-tight">The artist studio.</h1><p className="mt-2 text-sm text-muted">Upload a painting, update availability, or remove a work.</p></div><button onClick={logout} className="btn-secondary self-start sm:self-auto">Sign out</button></div>
            {notice && <p className="mb-4 rounded-xl border border-[#cdddc9] bg-[#edf4e9] px-4 py-3 text-sm text-[#47684b]">{notice}</p>}
            {error && <p className="mb-4 rounded-xl border border-[#e8c7bc] bg-[#f9e8e3] px-4 py-3 text-sm text-[#9a3d2c]">{error}</p>}
            <div className="grid gap-8 lg:grid-cols-[.85fr_1.15fr]">
              <section className="h-fit rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-6 shadow-soft sm:p-8"><h2 className="font-display text-3xl">Add a new work</h2><p className="mt-2 text-xs leading-5 text-muted">Use the exact packed parcel measurements for live courier pricing.</p><form onSubmit={upload} className="mt-6 grid gap-4">
                <label><span className="label">Painting photo</span><input id="painting-photo" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => setPhoto(e.target.files?.[0] || null)} required className="block w-full text-xs text-muted file:mr-3 file:rounded-full file:border-0 file:bg-[#eee7dc] file:px-4 file:py-3 file:text-[10px] file:font-bold file:uppercase file:tracking-wider file:text-ink"/></label>
                <label><span className="label">Title</span><input name="title" className="field" value={form.title} onChange={updateForm} required maxLength={120} placeholder="e.g. The Monsoon Courtyard"/></label>
                <label><span className="label">Medium</span><input name="medium" className="field" value={form.medium} onChange={updateForm} required maxLength={120} placeholder="e.g. Acrylic on canvas"/></label>
                <label><span className="label">Canvas size / dimensions</span><input name="dimensions" className="field" value={form.dimensions} onChange={updateForm} required maxLength={100} placeholder="e.g. 24 × 36 in / 61 × 91 cm"/></label>
                <label><span className="label">Price (INR)</span><input name="price" type="number" min="1" step="0.01" className="field" value={form.price} onChange={updateForm} required placeholder="12000"/></label>
                <div className="grid grid-cols-3 gap-3"><label><span className="label">Length (cm)</span><input name="length_cm" type="number" min="1" step="0.1" className="field" value={form.length_cm} onChange={updateForm} required placeholder="70"/></label><label><span className="label">Breadth (cm)</span><input name="breadth_cm" type="number" min="1" step="0.1" className="field" value={form.breadth_cm} onChange={updateForm} required placeholder="10"/></label><label><span className="label">Height (cm)</span><input name="height_cm" type="number" min="1" step="0.1" className="field" value={form.height_cm} onChange={updateForm} required placeholder="90"/></label></div>
                <label><span className="label">Packed weight (kg)</span><input name="weight_kg" type="number" min="0.01" step="0.01" className="field" value={form.weight_kg} onChange={updateForm} required placeholder="3.5"/></label>
                <button disabled={busy} className="btn-primary mt-2 w-full">{busy ? 'Uploading…' : 'Upload artwork'} <span>↗</span></button>
              </form></section>
              <section><div className="mb-4 flex items-end justify-between"><div><h2 className="font-display text-3xl">All artworks</h2><p className="mt-1 text-xs text-muted">{paintings.length} {paintings.length === 1 ? 'work' : 'works'} in your database</p></div><button onClick={() => loadPaintings().catch((e) => setError(e.message))} className="text-[10px] font-bold uppercase tracking-[.13em] text-clay underline underline-offset-4">Refresh</button></div>
                {paintings.length === 0 ? <div className="rounded-2xl border border-dashed border-[#cfc2b1] p-10 text-center text-sm text-muted">No paintings yet. Upload the first one from the form.</div> : <div className="grid gap-3">{paintings.map((painting) => <article key={painting.id} className="flex gap-4 rounded-2xl border border-[#e5dccf] bg-[#fffdf8] p-3 shadow-[0_5px_22px_rgba(55,42,30,.035)]"><img src={painting.image_url} alt={painting.title} className="h-28 w-24 rounded-xl bg-[#e8dfd3] object-cover"/><div className="min-w-0 flex-1 py-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-xl">{painting.title}</h3><span className={`rounded-full px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.12em] ${painting.is_sold ? 'bg-[#eee1dc] text-[#984b37]' : 'bg-[#e7eee3] text-[#4d6d4d]'}`}>{painting.is_sold ? 'Sold' : 'Available'}</span></div><p className="mt-1 truncate text-[10px] uppercase tracking-[.1em] text-muted">{painting.medium} · {painting.dimensions}</p><p className="mt-2 text-sm font-semibold text-clay">{money(painting.price)}</p><div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} onClick={() => toggleSold(painting)} className="rounded-full border border-[#d9cfc1] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#51483f]">Mark {painting.is_sold ? 'available' : 'sold'}</button><button disabled={busy} onClick={() => removePainting(painting)} className="rounded-full border border-[#e4c7bd] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#a24d36]">Delete</button></div></div></article>)}</div>}
              </section>
            </div>
          </>
        )}
        <p className="mt-12 text-center text-[9px] uppercase tracking-[.2em] text-[#9c9184]">Rangrekha · Private artist studio</p>
      </div>
    </main>
  );
}
