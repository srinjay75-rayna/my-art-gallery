import Link from 'next/link';

export function ArtisteLogoMark({ size = 46, className = '' }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 72 72" width={size} height={size} fill="none">
        <circle cx="36" cy="36" r="33" stroke="#C69C6D" strokeWidth="1.15" />
        <circle cx="36" cy="36" r="28.5" stroke="#B85D3B" strokeOpacity=".62" strokeWidth=".75" />
        <path d="M36 8.5c3.1 5.2 3.1 9.5 0 12.7-3.1-3.2-3.1-7.5 0-12.7Z" fill="#C69C6D"/>
        <path d="M36 63.5c3.1-5.2 3.1-9.5 0-12.7-3.1 3.2-3.1 7.5 0 12.7Z" fill="#C69C6D"/>
        <path d="M8.5 36c5.2-3.1 9.5-3.1 12.7 0-3.2 3.1-7.5 3.1-12.7 0Z" fill="#C69C6D"/>
        <path d="M63.5 36c-5.2-3.1-9.5-3.1-12.7 0 3.2 3.1 7.5 3.1 12.7 0Z" fill="#C69C6D"/>
        <path d="M17 20c5.6.1 8.9 2.2 9.9 6.4-4.2-1-6.3-4.3-6.4-9.9Z" stroke="#263832" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M55 20c-5.6.1-8.9 2.2-9.9 6.4 4.2-1 6.3-4.3 6.4-9.9Z" stroke="#263832" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M17 52c5.6-.1 8.9-2.2 9.9-6.4-4.2 1-6.3 4.3-6.4 9.9Z" stroke="#263832" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M55 52c-5.6-.1-8.9-2.2-9.9-6.4 4.2 1 6.3 4.3 6.4 9.9Z" stroke="#263832" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M27 48c4.5-6.1 8.9-11.7 9-23.8 1.3 7.7 3.7 12.6 9 17.9" stroke="#B85D3B" strokeWidth="1.35" strokeLinecap="round"/>
        <path d="M31 36c-4.2-1.5-6.6-4.4-7.1-8.5 4.7.6 7.1 3.4 7.1 8.5ZM41 42c4.1-1.6 6.5-4.4 7-8.5-4.7.6-7 3.4-7 8.5Z" fill="#C69C6D" fillOpacity=".85" stroke="#96744F" strokeWidth=".6"/>
        <path d="M36 22v29" stroke="#263832" strokeWidth="1.1" strokeLinecap="round"/>
        <path d="M30 52c2.1 1.7 4.1 2.5 6 2.5s3.9-.8 6-2.5" stroke="#B85D3B" strokeWidth="1.1" strokeLinecap="round"/>
        <text x="36" y="43.5" textAnchor="middle" fill="#263832" fontFamily="Georgia,serif" fontSize="18" fontStyle="italic">A</text>
      </svg>
    </span>
  );
}

export default function ArtisteLogo({ size = 46, subtitle = 'The Indian art house', href = '/', className = '' }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-3 ${className}`} aria-label="Artiste home">
      <ArtisteLogoMark size={size} />
      <span className="min-w-0">
        <b className="block font-serif text-[25px] leading-none tracking-[-.035em] text-[#263832]">Artiste</b>
        {subtitle && <small className="mt-1 block text-[8px] uppercase tracking-[.25em] text-[#827666]">{subtitle}</small>}
      </span>
    </Link>
  );
}
