import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { requireServiceRole } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Exact legacy terms accepted by applications submitted before V17 began
// recording immutable agreement text alongside the checkbox snapshot.
const LEGACY_AGREEMENT_TEXTS = {
  original_work: 'I confirm that every submitted artwork is 100% original work created by me and that I hold the rights to sell it.',
  commission_and_payout: 'I agree to the 70% Artist / 30% Platform split, or the 80% Artist / 20% Platform split if I am approved as a Founding Artist, and understand payout is released 48 hours after courier delivery is marked Delivered.',
  secure_packing: 'I agree to securely pack each sold artwork and make it ready for courier pickup within 48 hours of the order.',
  promotion_permission: 'I permit Artiste to use approved artwork photos and promotional / behind-the-scenes clips to market my work.',
};

function cleanPdfText(value) {
  return String(value ?? '—')
    .replace(/₹/g, 'INR ')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^\x20-\x7E]/g, '?');
}
function escapePdf(value) {
  return cleanPdfText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
function wrapLine(value, max = 92) {
  const words = cleanPdfText(value).split(/\s+/).flatMap((word) => {
    if (word.length <= max) return [word];
    const chunks = [];
    for (let offset = 0; offset < word.length; offset += max) chunks.push(word.slice(offset, offset + max));
    return chunks;
  });
  const rows = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > max && line) { rows.push(line); line = word; }
    else line = candidate;
  }
  if (line) rows.push(line);
  return rows.length ? rows : [''];
}
function buildPdf(lines) {
  const pageLines = [];
  for (let i = 0; i < lines.length; i += 48) pageLines.push(lines.slice(i, i + 48));
  if (!pageLines.length) pageLines.push(['Artiste Approval Dossier']);
  const objects = [];
  const pageIds = [];
  const fontId = 3 + pageLines.length * 2;
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${pageLines.map((_, index) => `${3 + index * 2} 0 R`).join(' ')}] /Count ${pageLines.length} >>`);
  for (let index = 0; index < pageLines.length; index += 1) {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    let stream = 'BT\n/F1 10 Tf\n50 790 Td\n';
    pageLines[index].forEach((line, lineIndex) => {
      const safe = escapePdf(line);
      if (lineIndex === 0 && index === 0) stream += '/F1 16 Tf\n';
      else if (lineIndex === 1 && index === 0) stream += '/F1 9 Tf\n';
      else stream += '/F1 10 Tf\n';
      stream += `(${safe}) Tj\n0 -15 Td\n`;
    });
    stream += 'ET';
    const streamLength = Buffer.byteLength(stream, 'ascii');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${streamLength} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'ascii');
}

export async function GET(_request, { params }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Admin authentication required.' }, { status: 401 });
  try {
    const { id } = await params;
    const supabase = requireServiceRole();
    const { data: application, error } = await supabase.from('artist_applications').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!application || String(application.application_status || '').toLowerCase() !== 'approved') {
      return NextResponse.json({ error: 'Approved application not found.' }, { status: 404 });
    }
    const agreements = application.agreement_texts && Object.keys(application.agreement_texts).length
      ? application.agreement_texts
      : application.agreements || {};
    const lines = [
      'ARTISTE — APPROVED ARTIST APPLICATION DOSSIER',
      `Prepared ${new Date().toLocaleString('en-IN')}`,
      '',
      `Artist / Studio: ${application.studio_name}`,
      `Applicant: ${application.full_name}`,
      `Email: ${application.email}`,
      `WhatsApp: ${application.whatsapp_number}`,
      `Instagram: ${application.instagram_handle ? `@${application.instagram_handle}` : 'Not supplied'}`,
      `City / PIN: ${application.city} / ${application.pincode}`,
      `Approval tier: ${application.approval_tier || (Number(application.commission_rate) === 0.20 ? '80/20' : '75/25')}`,
      `Artist share: ${Math.round((1 - Number(application.commission_rate ?? 0.25)) * 100)}%`,
      `Approved at: ${application.approved_at || application.updated_at || '—'}`,
      `Application submitted: ${application.created_at || '—'}`,
      '',
      'ARTIST BIO',
      ...wrapLine(application.art_style_bio || 'No bio supplied.'),
      '',
      'PORTFOLIO IMAGE LINKS',
      ...((Array.isArray(application.artwork_photos) ? application.artwork_photos : []).flatMap((url, index) => wrapLine(`${index + 1}. ${url}`))),
      '',
      'ACCEPTED CONSENT AGREEMENTS',
      ...['original_work', 'commission_and_payout', 'secure_packing', 'promotion_permission'].flatMap((key, index) => {
        const consent = typeof agreements[key] === 'string' && agreements[key]
          ? agreements[key]
          : agreements[key] === true
            ? LEGACY_AGREEMENT_TEXTS[key]
            : 'Not recorded';
        return [`${index + 1}. ${key.replaceAll('_', ' ').toUpperCase()}`, ...wrapLine(consent)];
      }),
      '',
      'This dossier is a private Artiste Studio Vault record.',
    ];
    const pdf = buildPdf(lines);
    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="artiste-approval-${String(application.studio_name || 'artist').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 50)}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not generate approval dossier.' }, { status: 500 });
  }
}
