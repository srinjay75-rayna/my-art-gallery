import './globals.css';
import Script from 'next/script';
export const metadata = {
  title: 'Artiste — Original Indian Art',
  description: 'Discover original Indian artworks by independent Artists. For Artists, For Customers.',
};
export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}<Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" /></body></html>;
}
