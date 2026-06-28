/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#fff1f1",
          100: "#ffe0e0",
          500: "#cc0000",
          600: "#b91c1c",
          700: "#991b1b",
        },
        "exl-orange": "#E8400C",
        "orange-deep": "#C4320A",
        "orange-light": "#F26335",
        "warm-tint": "#FFF4F0",
        sidebar: "#181A20",
        "chat-bg": "#F5F5F7",
        surface: "#FFFFFF",
        "text-primary": "#0D0D12",
        "text-secondary": "#4A4A5A",
        "active-green": "#10B981",
        "score-excellent": "#15803d",
        "score-good": "#84cc16",
        "score-needs-attention": "#f59e0b",
        "score-critical": "#ef4444",
      },
      fontFamily: {
        jakarta: ['"Plus Jakarta Sans"', "sans-serif"],
        instrument: ['"Instrument Serif"', "serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
}

