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
          // Primary accent - driven by CSS variable (default: Steel Blue)
          accent: {
            DEFAULT: "rgb(var(--ops-accent-rgb, 111 148 176) / <alpha-value>)",
            hover: "var(--ops-accent-hover, #82a8c4)",
            muted: "var(--ops-accent-muted, rgba(111, 148, 176, 0.15))",
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

        // === Glass Surface System (frosted backdrop tokens) ===
        glass: {
          DEFAULT: "var(--glass-bg)",
          dense: "var(--glass-bg-dense)",
          border: "var(--glass-border)",
          "border-medium": "var(--glass-border-medium)",
          "border-strong": "var(--glass-border-strong)",
        },

        // === Background System (pure black base — OPSStyle) ===
        background: {
          DEFAULT: "#000000",
          dark: "#090C15",
          panel: "#0A0A0A",
          card: "#191919",
          "card-dark": "#0D0D0D",
          elevated: "#1A1A1A",
          input: "#111111",
          status: "#1D1D1D",
        },

        // === Text System (spec v2 — 2026-04-17) ===
        text: {
          // Legacy aliases — values shifted to spec v2. Hardcoded `text-text-primary`
          // class usage across the codebase auto-upgrades via these.
          primary: "#EDEDED",           // was #E5E5E5
          secondary: "#B5B5B5",         // was #A7A7A7
          tertiary: "#8A8A8A",          // was #777777
          disabled: "#6A6A6A",          // was #555555
          inactive: "#6A6A6A",          // was #878787 — now aligns with text-mute
          placeholder: "#8A8A8A",       // was #999999
          inverse: "#000000",
          // Command Deck spec tokens (WCAG AA verified vs #000)
          DEFAULT: "#EDEDED",           // 18.8:1 AAA — primary body, hero, names
          "2": "#B5B5B5",               // 10.3:1 AAA — secondary values, ghost buttons, links
          "3": "#8A8A8A",               // 5.4:1 AA — labels, metadata, subtitles
          mute: "#6A6A6A",              // 3.4:1 AA large — decorative only: // slashes, separators
        },

        // === Border System (spec v2 — 10% default, not 20%) ===
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.10)",     // was 0.2 — spec is 0.10
          subtle: "rgba(255, 255, 255, 0.05)",
          medium: "rgba(255, 255, 255, 0.18)",      // was 0.2 — aligned to active-state border
          strong: "rgba(255, 255, 255, 0.25)",      // was 0.3 — aligned to border-hover
          button: "rgba(255, 255, 255, 0.10)",      // was 0.4 — buttons use standard hairline now
          separator: "rgba(255, 255, 255, 0.10)",   // was 0.15
          input: "rgba(255, 255, 255, 0.10)",       // was 0.2 — aligned to spec
          glass: "rgba(255, 255, 255, 0.09)",       // spec glass-border
        },

        // === Status Colors (spec v2 Thermal Map — globally unique hexes) ===
        // Pipeline / Project / Task / Estimate / Invoice palettes per system.md.
        // Every status across all enums has a globally unique hex.
        status: {
          // ProjectStatus — "Thermal Map" (slate → moss → marigold HOT → terracotta → graphite)
          rfq: "#8F9AA3",                // was #BCBCBC
          estimated: "#B6AC97",          // was #B5A381
          accepted: "#8FA577",           // was #9DB582
          "in-progress": "#D99A3E",      // was #8195B5 — now HOT marigold
          completed: "#BA7458",          // was #B58289
          closed: "#8C6A57",             // was #E9E9E9
          archived: "#4E4B48",           // was #A182B5
          // TaskStatus — tan → warm steel → sage → dim rose
          booked: "#CFB074",             // was #9DB582
          "task-in-progress": "#6E9CB8",
          "task-completed": "#95B07A",
          cancelled: "#8E6E73",          // was #93321A — now dim rose
          // Earth-tone semantic (prefer these for generic success/warning/error)
          success: "#9DB582",            // olive — was #A5B368
          warning: "#C4A868",            // tan
          error: "#B58289",              // rose (for text); #93321A brick for borders only
        },

        // === Task Type Default Colors (spec v2 — from system.md default TaskType table) ===
        tasktype: {
          estimate: "#9DB582",           // olive
          quote: "#6F94B0",              // steel (= ops-accent) — was #59779F
          material: "#C4A868",           // tan
          installation: "#B58289",       // rose — was #931A32 (was a non-spec red)
          inspection: "#A69AB5",         // lilac
          completion: "#9C938A",         // stone — was #4A4A4A
        },

        // === Accounting & Financial Colors ===
        financial: {
          revenue: "#C4A868",
          profit: "#9DB582",
          cost: "#B58289",
          receivables: "#D4A574",
          overdue: "#93321A",
          current: "#9DB582",            // current / not-yet-due A/R (healthy) — = olive/profit
        },

        // === Neutral Fills (non-interactive data: bars, tracks, skeletons) ===
        fill: {
          neutral: "rgba(255, 255, 255, 0.14)",
          "neutral-dim": "rgba(255, 255, 255, 0.06)",
        },

        // === Surface Interaction (hover, active, toggle states) ===
        surface: {
          hover: "rgba(255, 255, 255, 0.05)",
          "hover-subtle": "rgba(255, 255, 255, 0.03)",
          active: "rgba(255, 255, 255, 0.08)",
          input: "rgba(255, 255, 255, 0.04)",
        },

        // === Earth-tone top-level aliases ===
        // These match the spec v2 names (system.md § Earth Tones) so callers
        // can write `bg-olive`/`text-rose` etc. directly. Values trace to the
        // status palette (status.success, status.warning, status.error) and
        // their CSS variables in globals.css.
        olive: "#9DB582",
        tan: "#C4A868",
        rose: "#B58289",
        brick: "#93321A",
        // Earth-tone soft fills / hairline borders — bound to the canonical
        // CSS variables in globals.css so callers write `bg-rose-soft`,
        // `border-rose-line`, `bg-tan-soft`, `border-tan-line` instead of
        // inlining the rgba literals. Mirrors the spec v2 earth-tone soft/line
        // ladder (12% fill / 30% border).
        "olive-soft": "var(--olive-soft)",
        "olive-line": "var(--olive-line)",
        "tan-soft": "var(--tan-soft)",
        "tan-line": "var(--tan-line)",
        "rose-soft": "var(--rose-soft)",
        "rose-line": "var(--rose-line)",
        "brick-line": "var(--brick-line)",
        // Top-level alias for the spec v2 `text.mute` token so callers can use
        // it as a background or border (e.g. status pips that need the muted
        // gray fill: `bg-text-mute`). Mirrors text.mute exactly.
        "text-mute": "#6A6A6A",
        // Top-level alias for spec v2 border-medium so `border-border-medium`
        // resolves directly without dipping into surface-active overlap.
        "border-medium": "rgba(255, 255, 255, 0.18)",
        line: "rgba(255, 255, 255, 0.10)",
        "line-hi": "rgba(255, 255, 255, 0.18)",

        // === Inbox surface tokens (scoped to /inbox routes) ===
        // Solid panels for the redesigned inbox. Glass remains the OPS-Web
        // system-wide default; these tokens must NOT leak into glass-surface
        // contexts. See docs/plans/2026-05-06-inbox-redesign.md.
        inbox: {
          bg: "#0E0F12",
          "bg-deep": "#08090B",
          panel: "#16181C",
          elev: "#1A1D22",
        },

        // === Agent Provenance Palette (Claude-authored surfaces only) ===
        // Reserved for AI-authored surfaces: summary band, "Claude drafted this"
        // labels, auto-sent banner, autonomy panel, AI-drafted bubbles & rows,
        // agent body text. Never on category chips, status pills, links, user
        // drafts, opportunities, "Your turn" banner, or human-authored content.
        // See .interface-design/system.md § Agent Provenance Palette.
        agent: {
          DEFAULT: "#8A7FB8",
          hi: "#B5ABDC",
          text: "#C9C0E6",
          text2: "#A39CC9",
          border: "rgba(138, 127, 184, 0.18)",
          "border-hi": "rgba(138, 127, 184, 0.36)",
          bg: "rgba(138, 127, 184, 0.04)",
          "bg-hi": "rgba(138, 127, 184, 0.10)",
        },
      },

      // === Typography ===
      fontFamily: {
        mohave: ["Mohave", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        cakemono: ["cake-mono", "Mohave", "sans-serif"],
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
        // Micro (labels, shortcuts, metadata)
        "micro": ["11px", { lineHeight: "1.3", fontWeight: "400" }],
        "micro-sm": ["10px", { lineHeight: "1.3", fontWeight: "400" }],
        "micro-xs": ["9px", { lineHeight: "1.3", fontWeight: "400" }],
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
        // Cake Mono display (uppercase, weight 300 ONLY) — the three sanctioned
        // Cake roles: display (page titles / section headers), button (buttons /
        // card titles / form labels), badge. Size + weight 300 baked, NO
        // line-height, so `font-cakemono text-cake-*` renders byte-identically to
        // the legacy `font-light text-[Npx]` it replaces. Always pair with
        // `font-cakemono`; never use the weight-baked Mohave tokens for Cake.
        "cake-display": ["22px", { fontWeight: "300" }],
        "cake-button": ["14px", { fontWeight: "300" }],
        "cake-badge": ["11px", { fontWeight: "300" }],
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
        // Command Deck spec named radii
        panel: "10px",
        modal: "12px",
        chip: "4px",
        bar: "2px",
        sidebar: "6px",
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
        // Restrained leftward push for rail flyouts (operator menu). A short
        // -16px slide + fade reads as "pushed out from the rail" without the
        // full-width drawer travel of slide-in-left.
        "push-in-left": {
          from: { transform: "translateX(-16px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "slide-up": {
          from: { transform: "translateY(8px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" },
        },
        "scale-in": {
          from: { transform: "translate(-50%, -50%) scale(0.95)", opacity: "0" },
          to: { transform: "translate(-50%, -50%) scale(1)", opacity: "1" },
        },
        "anchored-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        typewriter: {
          from: { width: "0" },
          to: { width: "100%" },
        },
        "blink-caret": {
          "0%, 100%": { borderColor: "transparent" },
          "50%": { borderColor: "rgba(255,255,255,0.3)" },
        },
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(350%)" },
        },
        "glow-flash": {
          "0%": { boxShadow: "0 0 0 0 rgba(111, 148, 176, 0)" },
          "20%": { boxShadow: "0 0 12px 2px rgba(111, 148, 176, 0.4)" },
          "100%": { boxShadow: "0 0 0 0 rgba(111, 148, 176, 0)" },
        },
      },
      // One easing curve everywhere (DESIGN.md §8) — every keyframe animation
      // runs on the OPS curve. typewriter/blink-caret are mechanical steps()
      // by design. The stock `pulse` is overridden so existing animate-pulse
      // skeletons inherit the curve with no call-site changes.
      animation: {
        pulse: "pulse 2s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        "pulse-live": "pulse-live 3s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        "fade-in": "fade-in 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-in-right": "slide-in-right 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-in-left": "slide-in-left 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
        "push-in-left": "push-in-left 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        "slide-up": "slide-up 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        "scale-in": "scale-in 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        "anchored-in": "anchored-in 0.15s cubic-bezier(0.22, 1, 0.36, 1)",
        "accordion-down": "accordion-down 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        "accordion-up": "accordion-up 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
        typewriter: "typewriter 1.5s steps(30) forwards",
        "blink-caret": "blink-caret 0.75s step-end infinite",
        shimmer: "shimmer 1.5s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        "glow-flash": "glow-flash 1s cubic-bezier(0.22, 1, 0.36, 1) forwards",
      },

      // === Backdrop Blur ===
      backdropBlur: {
        xs: "2px",
      },

      // === Transition Easing ===
      // The single OPS motion curve. Setting it as the DEFAULT means every
      // `transition-*` utility (and bare `transition`) inherits the OPS curve
      // app-wide instead of Tailwind's stock cubic-bezier(0.4,0,0.2,1).
      // Honors "one easing curve everywhere" (DESIGN.md § motion).
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.22, 1, 0.36, 1)",
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
