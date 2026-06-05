import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Group Travel Video",
  description: "Group travel video generator — mobile web MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
