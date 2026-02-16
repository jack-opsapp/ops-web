import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // === OPS Brand Colors ===
        ops: {
          // Primary accent - Steel Blue (used sparingly)
          accent: {
            DEFAULT: "#417394",
            hover: "#4d83a6",
            muted: "rgba(65, 115, 148, 0.15)",
          },
          // Secondary accent - Amber/Gold (active state ONLY)
          amber: {
            DEFAULT: "#C4A868",
            hover: "#d4b878",
            muted: "rgba(196, 168, 104, 0.15)",
          },
          // Error - Deep Brick Red
          error: {
            DEFAULT: "#93321A",
            hover: "#a63d20",
            muted: "rgba(147, 50, 26, 0.15)",
          },
        },

        // === Background System (charcoal with blue undertones) ===
        background: {
          DEFAULT: "#0B0D11",
          dark: "#090C15",
          panel: "#10131A",
          card: "#161A22",
          "card-dark": "#0D1017",
          elevated: "#1C2028",
          input: "#0E1117",
        },

        // === Text System (blue-grey, not pure grey) ===
        text: {
          primary: "#E2E4E9",
          secondary: "#8B8F9A",
          tertiary: "#5C6070",
          disabled: "#3D4150",
          inverse: "#0B0D11",
        },

        // === Border System (subtle) ===
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.06)",
          subtle: "rgba(255, 255, 255, 0.03)",
          medium: "rgba(255, 255, 255, 0.1)",
          strong: "rgba(255, 255, 255, 0.2)",
        },

        // === Status Colors (from iOS OPSStyle) ===
        status: {
          rfq: "#BCBCBC",
          estimated: "#B5A381",
          accepted: "#9DB582",
          "in-progress": "#8195B5",
          completed: "#B58289",
          closed: "#E9E9E9",
          archived: "#A182B5",
          booked: "#9DB582",
          cancelled: "#93321A",
          success: "#A5B368",
          warning: "#C4A868",
          error: "#93321A",
        },

        // === Task Type Default Colors ===
        tasktype: {
          estimate: "#A5B368",
          quote: "#59779F",
          material: "#C4A868",
          installation: "#931A32",
          inspection: "#7B68A6",
          completion: "#4A4A4A",
        },
      },

      // === Typography ===
      fontFamily: {
        mohave: ["Mohave", "sans-serif"],
        kosugi: ["Kosugi", "sans-serif"],
        bebas: ["Bebas Neue", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },

      fontSize: {
        // Headers
        "display-lg": ["32px", { lineHeight: "1.2", fontWeight: "700" }],
        "display": ["28px", { lineHeight: "1.2", fontWeight: "600" }],
        "heading": ["22px", { lineHeight: "1.3", fontWeight: "600" }],
        // Body
        "body-lg": ["18px", { lineHeight: "1.5", fontWeight: "500" }],
        "body": ["16px", { lineHeight: "1.5", fontWeight: "400" }],
        "body-sm": ["14px", { lineHeight: "1.5", fontWeight: "300" }],
        // Supporting
        "caption": ["14px", { lineHeight: "1.4", fontWeight: "400" }],
        "caption-bold": ["14px", { lineHeight: "1.4", fontWeight: "600" }],
        "caption-sm": ["12px", { lineHeight: "1.4", fontWeight: "400" }],
        // Cards
        "card-title": ["18px", { lineHeight: "1.3", fontWeight: "500" }],
        "card-subtitle": ["15px", { lineHeight: "1.4", fontWeight: "400" }],
        "card-body": ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        // UI
        "button": ["16px", { lineHeight: "1", fontWeight: "400" }],
        "button-sm": ["14px", { lineHeight: "1", fontWeight: "500" }],
        "status": ["12px", { lineHeight: "1", fontWeight: "500" }],
        // Data display (monospace)
        "data-lg": ["20px", { lineHeight: "1.2", fontWeight: "600" }],
        "data": ["16px", { lineHeight: "1.3", fontWeight: "400" }],
        "data-sm": ["13px", { lineHeight: "1.3", fontWeight: "400" }],
      },

      // === Spacing (8-point grid) ===
      spacing: {
        "0.5": "4px",
        "1": "8px",
        "1.5": "12px",
        "2": "16px",
        "3": "24px",
        "4": "32px",
        "5": "40px",
        "6": "48px",
        "7": "56px",
        "8": "64px",
      },

      // === Border Radius (iOS OPSStyle) ===
      borderRadius: {
        sm: "2.5px",
        DEFAULT: "5px",
        md: "5px",
        lg: "8px",
        xl: "12px",
      },

      // === Box Shadow (subtle elevation, no glows) ===
      boxShadow: {
        "card": "0 1px 3px rgba(0, 0, 0, 0.3)",
        "elevated": "0 4px 12px rgba(0, 0, 0, 0.4)",
        "floating": "0 8px 24px rgba(0, 0, 0, 0.5)",
      },

      // === Animations ===
      keyframes: {
        "pulse-live": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "scale-in": {
          from: { transform: "scale(0.95)", opacity: "0" },
          to: { transform: "scale(1)", opacity: "1" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "pulse-live": "pulse-live 3s ease-in-out infinite",
        "fade-in": "fade-in 0.2s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "slide-in-left": "slide-in-left 0.3s ease-out",
        "slide-up": "slide-up 0.2s ease-out",
        "scale-in": "scale-in 0.15s ease-out",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },

      // === Backdrop Blur ===
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
