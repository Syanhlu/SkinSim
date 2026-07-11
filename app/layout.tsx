export const metadata = {
  title: "SkinSim — Synthetic A/B Testing",
  description: "Test your ads on a simulated Vietnamese audience before spending money on real ones",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
