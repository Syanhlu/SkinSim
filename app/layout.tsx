import { Poppins } from "next/font/google";

// VNG's brand typeface is SVN-Gilroy (Gilroy family). Gilroy is not a free web
// font, so we load Poppins — the standard geometric-sans stand-in for Gilroy —
// and let the CSS stack prefer a locally installed SVN-Gilroy/Gilroy first.
const brand = Poppins({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-brand",
  display: "swap",
});

export const metadata = {
  title: "Agamotto — Synthetic A/B Testing",
  description: "Test your ads on a simulated Vietnamese audience before spending money on real ones",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={brand.variable}>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
