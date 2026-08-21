import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stillpoint-frontier.michaelcrosato.chatgpt.site"),
  title: "Stillpoint Frontier",
  description:
    "A low-motion Three.js frontier across a streamed 96 km territory of biomes, settlements, movement, and gathering.",
  openGraph: {
    title: "Stillpoint Frontier",
    description: "Cross the Greywater. Read the land. Shape the frontier.",
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
    description: "Cross the Greywater. Read the land. Shape the frontier.",
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
