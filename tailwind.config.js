/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,mdx}',
    './components/**/*.{js,jsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#28231f',
        paper: '#f7f3ec',
        clay: '#a24d36',
        saffron: '#d6a45d',
        muted: '#756d64',
      },
      boxShadow: {
        soft: '0 18px 55px rgba(55, 42, 30, 0.09)',
      },
      fontFamily: {
        display: ['Georgia', 'Times New Roman', 'serif'],
        sans: ['Arial', 'Helvetica', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
