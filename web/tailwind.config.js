/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        navy: {
          900: '#0a1f3d',
          800: '#0f2a52',
          700: '#1e3a5f',
          600: '#2a4d7a',
          100: '#e8eef6',
        },
        gold: {
          700: '#b8860b',
          600: '#d4a017',
          500: '#f0a500',
          400: '#f5b942',
          100: '#fef5e0',
        },
      },
      fontFamily: {
        display: ['Poppins', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        nepali: ['Mukta', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
