"use client";

import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface PortalPhotoGalleryProps {
  photos: string[];
}

export function PortalPhotoGallery({ photos }: PortalPhotoGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const isOpen = lightboxIndex !== null;

  const goToPrevious = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex(lightboxIndex === 0 ? photos.length - 1 : lightboxIndex - 1);
  }, [lightboxIndex, photos.length]);

  const goToNext = useCallback(() => {
    if (lightboxIndex === null) return;
    setLightboxIndex(lightboxIndex === photos.length - 1 ? 0 : lightboxIndex + 1);
  }, [lightboxIndex, photos.length]);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          goToPrevious();
          break;
        case "ArrowRight":
          e.preventDefault();
          goToNext();
          break;
        case "Escape":
          e.preventDefault();
          closeLightbox();
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, goToPrevious, goToNext, closeLightbox]);

  // Prevent body scroll when lightbox is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (photos.length === 0) return null;

  return (
    <>
      {/* Grid */}
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: photos.length === 1
            ? "1fr"
            : photos.length === 2
              ? "1fr 1fr"
              : "repeat(3, 1fr)",
        }}
      >
        {photos.map((photo, index) => (
          <button
            key={index}
            onClick={() => setLightboxIndex(index)}
            className="relative overflow-hidden group"
            style={{
              borderRadius: "var(--portal-radius)",
              aspectRatio: photos.length === 1 ? "16/9" : "1",
            }}
          >
            <img
              src={photo}
              alt={`Photo ${index + 1}`}
              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            <div
              className="absolute inset-0 bg-black opacity-0 group-hover:opacity-20 transition-opacity"
            />
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {isOpen && lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.9)" }}
        >
          {/* Backdrop click to close */}
          <div
            className="absolute inset-0"
            onClick={closeLightbox}
          />

          {/* Close button */}
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 z-10 p-2 rounded-full transition-colors"
            style={{
              backgroundColor: "rgba(255,255,255,0.1)",
              color: "#fff",
            }}
            aria-label="Close lightbox"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Counter */}
          <div
            className="absolute top-4 left-4 z-10 px-3 py-1.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: "rgba(255,255,255,0.1)",
              color: "#fff",
            }}
          >
            {lightboxIndex + 1} / {photos.length}
          </div>

          {/* Previous button */}
          {photos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToPrevious();
              }}
              className="absolute left-4 z-10 p-2 rounded-full transition-colors"
              style={{
                backgroundColor: "rgba(255,255,255,0.1)",
                color: "#fff",
              }}
              aria-label="Previous photo"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          {/* Image */}
          <img
            src={photos[lightboxIndex]}
            alt={`Photo ${lightboxIndex + 1}`}
            className="relative z-0 max-h-[85vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next button */}
          {photos.length > 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goToNext();
              }}
              className="absolute right-4 z-10 p-2 rounded-full transition-colors"
              style={{
                backgroundColor: "rgba(255,255,255,0.1)",
                color: "#fff",
              }}
              aria-label="Next photo"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>
      )}
    </>
  );
}
