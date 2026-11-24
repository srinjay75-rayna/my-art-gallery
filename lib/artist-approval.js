/**
 * Shared Founding Artist approval checks for authenticated Artist APIs.
 * Approval can be represented by the permanent artist flag or by the latest
 * application status (kept compatible with existing Pending/Approved values).
 */
export async function getLatestArtistApplication(supabase, artistId) {
  if (!artistId) return null;
  const { data, error } = await supabase
    .from('artist_applications')
    .select('id,application_status,created_at')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    status: String(data.application_status || '').trim().toLowerCase(),
  };
}

export async function isArtistFoundingApproved(supabase, artist) {
  if (artist?.is_founding_artist === true) return true;
  const application = await getLatestArtistApplication(supabase, artist?.id);
  return application?.status === 'approved';
}
