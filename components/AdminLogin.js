"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not sign in.');
      setPassword('');
      router.refresh();
    } catch (err) {
      setError(err.message || 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return <main className="paper-grain min-h-screen px-5 py-16">
    <div className="mx-auto max-w-md rounded-3xl border border-[#e5dccf] bg-[#fffdf8] p-8 shadow-soft">
      <a href="/" className="mb-8 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full border border-clay/40 font-display text-xl text-clay">A</span><span className="font-display text-2xl">Artiste</span></a>
      <p className="eyebrow">For Artiste owner</p><h1 className="mt-2 font-display text-4xl">Super-admin login</h1>
      <form onSubmit={login} className="mt-7 grid gap-4"><input type="password" className="field" placeholder="Admin password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /><button disabled={busy} className="btn-primary">{busy ? 'Signing in…' : 'Enter dashboard'} ↗</button></form>
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
    </div>
  </main>;
}
