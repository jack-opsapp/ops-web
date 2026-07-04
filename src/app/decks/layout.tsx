import * as React from "react";

export const metadata = {
  title: "OPS Decks",
  robots: { index: false, follow: false },
};

/**
 * Standalone shell for Deckset web surfaces (Stripe checkout return today).
 * Deliberately auth-free — a purchaser may have no OPS web login. Inherits the
 * root layout's black canvas, Cake Mono typeface, and font-mohave body.
 */
export default function DecksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
