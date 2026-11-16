/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        indigo: {
          DEFAULT: "oklch(55% 0.22 264)",
          dim: "oklch(48% 0.19 264)",
          muted: "oklch(55% 0.22 264 / 0.15)",
        },
        mint: {
          DEFAULT: "oklch(72% 0.18 168)",
          dim: "oklch(62% 0.15 168)",
          muted: "oklch(72% 0.18 168 / 0.15)",
        },
        amber: {
          DEFAULT: "oklch(78% 0.17 85)",
          dim: "oklch(68% 0.14 85)",
          muted: "oklch(78% 0.17 85 / 0.15)",
        },
        rose: {
          DEFAULT: "oklch(65% 0.21 15)",
          dim: "oklch(55% 0.18 15)",
          muted: "oklch(65% 0.21 15 / 0.15)",
        },
        chalk: {
          bg: "oklch(14% 0.01 264)",
          "bg-2": "oklch(18% 0.015 264)",
          "bg-3": "oklch(22% 0.02 264)",
          border: "oklch(28% 0.025 264)",
          "border-2": "oklch(35% 0.03 264)",
          subtle: "oklch(50% 0.04 264)",
          muted: "oklch(65% 0.03 264)",
          text: "oklch(92% 0.01 264)",
        },
        // ── Apple-white light surface palette (landing page) ──────────────
        apple: {
          bg: "#FAFAF7",
          surface: "#FFFFFF",
          ink: "#0A0A0B",
          "ink-2": "#27272A",
          "ink-3": "#52525B",
          "ink-4": "#71717A",
          mist: "#F4F4F2",
          "mist-2": "#EAEAE6",
          line: "#E5E5E0",
          "line-2": "#D4D4D0",
        },
        // ── Berry accents (collab cursors + soft highlights) ─────────────
        // Strawberry red lives ONLY inside mascot art, never on UI chrome.
        berry: {
          blue: "#5B7FFF",
          "blue-soft": "#EEF2FF",
          purple: "#9B7BFF",
          "purple-soft": "#F4EFFF",
          coral: "#FF8A7E",
          "coral-soft": "#FFEFEC",
          mint: "#7FD9C0",
          "mint-soft": "#ECFAF5",
          amber: "#F4C56A",
          "amber-soft": "#FFF6E2",
        },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["DM Mono", "SF Mono", "ui-monospace", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      borderRadius: {
        sm: "10px",
        DEFAULT: "16px",
        lg: "24px",
      },
      boxShadow: {
        glow: "0 0 24px oklch(55% 0.22 264 / 0.35)",
        "glow-mint": "0 0 24px oklch(72% 0.18 168 / 0.35)",
        "glow-amber": "0 0 24px oklch(78% 0.17 85 / 0.35)",
        card: "0 1px 3px oklch(0% 0 0 / 0.4), 0 0 0 1px oklch(28% 0.025 264)",
        // ── Layered "floating 20px off the page" shadows for light surfaces
        "lift-sm": [
          "0 1px 2px rgba(15, 23, 42, 0.04)",
          "0 2px 6px rgba(15, 23, 42, 0.04)",
          "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
        ].join(", "),
        "lift-md": [
          "0 1px 2px rgba(15, 23, 42, 0.04)",
          "0 4px 12px rgba(15, 23, 42, 0.05)",
          "0 12px 24px -8px rgba(15, 23, 42, 0.08)",
          "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
        ].join(", "),
        "lift-xl": [
          "0 1px 2px rgba(15, 23, 42, 0.04)",
          "0 4px 8px rgba(15, 23, 42, 0.04)",
          "0 16px 32px -8px rgba(15, 23, 42, 0.06)",
          "0 32px 64px -16px rgba(15, 23, 42, 0.10)",
          "inset 0 1px 0 rgba(255, 255, 255, 0.6)",
        ].join(", "),
        "lift-glass": [
          "0 1px 2px rgba(15, 23, 42, 0.05)",
          "0 8px 24px -4px rgba(15, 23, 42, 0.06)",
          "inset 0 1px 0 rgba(255, 255, 255, 0.9)",
          "inset 0 0 0 1px rgba(255, 255, 255, 0.5)",
        ].join(", "),
        "berry-blue": "0 16px 40px -12px rgba(91, 127, 255, 0.45)",
        "berry-purple": "0 16px 40px -12px rgba(155, 123, 255, 0.40)",
      },
      backdropBlur: {
        xs: "4px",
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.4)", opacity: "0.7" },
        },
        orbFloat: {
          "0%, 100%": { transform: "translateY(0px) scale(1)" },
          "50%": { transform: "translateY(-20px) scale(1.04)" },
        },
        confettiFall: {
          "0%": { transform: "translateY(-10px) rotate(0deg)", opacity: "1" },
          "100%": { transform: "translateY(100vh) rotate(720deg)", opacity: "0" },
        },
        popIn: {
          "0%": { transform: "scale(0.85)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        slideInRight: {
          "0%": { transform: "translateX(20px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        cursorPulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        softFloat: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
      animation: {
        pulseDot: "pulseDot 2s ease-in-out infinite",
        orbFloat: "orbFloat 6s ease-in-out infinite",
        confettiFall: "confettiFall 3s ease-in forwards",
        popIn: "popIn 0.2s ease-out forwards",
        slideInRight: "slideInRight 0.25s ease-out forwards",
        fadeIn: "fadeIn 0.3s ease-out forwards",
        blink: "blink 1s step-start infinite",
        cursorPulse: "cursorPulse 1.2s ease-in-out infinite",
        softFloat: "softFloat 5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
