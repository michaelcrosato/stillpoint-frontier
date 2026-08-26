import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stillpoint-frontier.michaelcrosato.chatgpt.site"),
  title: "Stillpoint Frontier",
  description:
    "A WebGPU-first, low-motion open-world exploration game built with PlayCanvas Engine v2.",
  openGraph: {
    title: "Stillpoint Frontier",
    description: "Restore the silent relays. Reconnect the frontier.",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1731,
        height: 909,
        alt: "Stillpoint Frontier relay tower in the Red Basin",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Stillpoint Frontier",
    description: "Restore the silent relays. Reconnect the frontier.",
    images: ["/og.png"],
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
