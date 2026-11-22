/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {
    colors: { ink: '#263832', clay: '#B85D3B', muted: '#746F66' },
    fontFamily: { display: ['Georgia', 'Times New Roman', 'serif'] },
    boxShadow: { soft: '0 18px 55px rgba(38,56,50,.10)' },
  } },
  plugins: [],
};
