import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // FLM identidad: fondo neutro cálido, estados semánticos
        flm: {
          bg: "#FAF7F1",
          surface: "#FFFFFF",
          ink: "#1C1917",
          muted: "#78716C",
          line: "#E7E0D5",
          // Estados de reporte (siempre acompañados de icono + texto, nunca solo color)
          pending: "#DC2626", // rojo: reportes pendientes
          progress: "#B45309", // ámbar oscuro: gestión en curso (contraste AA sobre claro)
          verified: "#15803D", // verde: soluciones verificadas
          institutional: "#1D4ED8", // azul sobrio: información institucional
          accent: "#C2410C", // naranjo terracota: marca / CTA
        },
      },
      fontFamily: {
        sans: [
          "var(--font-geist-sans)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,25,23,0.06), 0 4px 16px rgba(28,25,23,0.06)",
        pop: "0 8px 32px rgba(28,25,23,0.12)",
      },
      maxWidth: {
        app: "72rem",
      },
    },
  },
  plugins: [],
};
export default config;
