import './globals.css';
import Script from 'next/script';

export const metadata = {
  title: 'Rangrekha — Original Indian Art',
  description: 'Discover original paintings and one-of-a-kind works by independent Indian artists.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
