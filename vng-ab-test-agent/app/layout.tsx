export const metadata = {
  title: "VNG A/B Test Agent",
  description: "AABW scaffold for statistically sound LiveOps experiment decisions",
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
