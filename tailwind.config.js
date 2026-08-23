/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        "sm-navy": "#172554",
        "sm-orange": "#F97316",
        "sm-orange-d": "#EA580C",
        "sm-peach": "#FDEBD9",
      },
      fontFamily: {
        sans: ["Pretendard", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
