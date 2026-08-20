import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stillpoint Frontier",
  description:
    "A low-motion first-person open-world survey game powered by Three.js.",
  openGraph: {
    title: "Stillpoint Frontier",
    description: "Read the land. Wake the signal.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stillpoint Frontier",
    description: "Read the land. Wake the signal.",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
