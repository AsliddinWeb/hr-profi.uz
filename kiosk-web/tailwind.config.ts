import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        // Brand palette mirrors admin-web. Slightly higher contrast on
        // primary so it pops on the high-bright tablet displays kiosks
        // run on.
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#b6d4ff",
          300: "#84b6ff",
          400: "#5290ff",
          500: "#2f70ff",
          600: "#1f5be6",
          700: "#1a47b8",
          800: "#193e94",
          900: "#1a3776",
        },
        ink: {
          50: "#f7f8fa",
          100: "#eef0f4",
          200: "#dee2ea",
          300: "#c2c9d6",
          400: "#9ba4b5",
          500: "#74809a",
          600: "#54607a",
          700: "#3e4861",
          800: "#262d40",
          900: "#11151f",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
