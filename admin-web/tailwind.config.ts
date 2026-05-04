import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand: violet (matches the modern admin style — used for primary
        // actions, active nav, brand accents).
        brand: {
          50: "#f5f3ff",
          100: "#ede9fe",
          200: "#ddd6fe",
          300: "#c4b5fd",
          400: "#a78bfa",
          500: "#8b5cf6",
          600: "#7c3aed",
          700: "#6d28d9",
          800: "#5b21b6",
          900: "#4c1d95",
        },
        ink: {
          50: "#f8fafc",
          100: "#f1f5f9",
          200: "#e2e8f0",
          300: "#cbd5e1",
          400: "#94a3b8",
          500: "#64748b",
          600: "#475569",
          700: "#334155",
          800: "#1e293b",
          900: "#0f172a",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        // Layered, subtle shadows tuned for white cards on a soft slate
        // background. Card = ambient + soft drop. Pop = used for floating
        // dialogs and active dropdowns.
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
        pop: "0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15, 23, 42, 0.06)",
        focus: "0 0 0 3px rgba(124, 58, 237, 0.18)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      transitionDuration: {
        "250": "250ms",
      },
    },
  },
  plugins: [],
} satisfies Config;
