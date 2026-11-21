import './globals.css';
import Script from 'next/script';
import ContactBar from '@/components/ContactBar';
import EditorialFooter from '@/components/EditorialFooter';
import ArtisteConcierge from '@/components/ArtisteConcierge';

export const metadata = {
  title: 'Artiste — Original Paintings & Fine-Art Photography',
  description: 'Artiste — Original Paintings & Fine-Art Photography, Delivered With Love From Independent Indian Studios to Your Home.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col">
          <ContactBar />
          <div className="flex-1">{children}</div>
          <EditorialFooter />
        </div>
        <ArtisteConcierge />
        <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
