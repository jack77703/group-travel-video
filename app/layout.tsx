import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reveel",
  description: "Everyone uploads secretly. You hit generate. They're surprised.",
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
