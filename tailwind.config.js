/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {
    colors: { ink: '#28231f', clay: '#a24d36', muted: '#80766a' },
    fontFamily: { display: ['Georgia', 'Times New Roman', 'serif'] },
    boxShadow: { soft: '0 18px 55px rgba(55,42,30,.08)' },
  } },
  plugins: [],
};
