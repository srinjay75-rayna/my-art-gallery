import './globals.css';
import Script from 'next/script';
import ContactBar from '@/components/ContactBar';
import EditorialFooter from '@/components/EditorialFooter';
import ChatWidget from '@/components/ChatWidget';
import SiteNavbar from '@/components/SiteNavbar';

export const metadata = {
  title: 'Artiste — Original Paintings & Fine-Art Photography',
  description: 'Artiste — Where Indian Heritage Meets Modern Walls. Every painting & photograph carries a human heartbeat, curated from independent studios and delivered with love.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col">
          <ContactBar />
          <SiteNavbar />
          <div className="flex-1">{children}</div>
          <EditorialFooter />
        </div>
        <ChatWidget />
        <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
