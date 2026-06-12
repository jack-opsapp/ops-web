import { Suspense } from "react";
import { BooksPage } from "@/components/books/books-page";

/**
 * /books — the unified financial hub (WEB OVERHAUL P3.1).
 * Suspense boundary is required for useSearchParams during prerender.
 */
export default function Books() {
  return (
    <Suspense fallback={null}>
      <BooksPage />
    </Suspense>
  );
}
