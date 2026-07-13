import { Poppins } from "next/font/google";
import type { Metadata } from "next";

// VNG's brand typeface is SVN-Gilroy (Gilroy family). Gilroy is not a free web
// font, so we load Poppins — the standard geometric-sans stand-in for Gilroy —
// and let the CSS stack prefer a locally installed SVN-Gilroy/Gilroy first.
const brand = Poppins({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-brand",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://vng-ab-test-agent.vercel.app";
const title = "Agamotto | Synthetic A/B Testing for Game Teams";
const description =
  "Prototype game skins, test them on a simulated Vietnamese audience, and get an evidence-backed ship, iterate, or kill verdict before launch.";
const previewImage = {
  url: "/vng-hero.png",
  width: 1672,
  height: 941,
  alt: "Agamotto game-skin testing preview artwork",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Agamotto",
  title,
  description,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Agamotto",
    title,
    description,
    images: [previewImage],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [previewImage.url],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={brand.variable}>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
