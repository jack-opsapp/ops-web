/**
 * OPS Web - Image Upload Hooks
 *
 * TanStack Query mutation hooks for single and multi-image uploads.
 * Provides upload state, previews, and error handling.
 */

import { useMutation } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import {
  uploadImage,
  uploadMultipleImages,
  ImageUploadError,
} from "../api/services/image-service";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UseImageUploadOptions {
  onSuccess?: (url: string) => void;
  onError?: (error: ImageUploadError) => void;
}

interface UseMultiImageUploadOptions {
  onSuccess?: (urls: string[]) => void;
  onError?: (error: ImageUploadError) => void;
}

// ─── Single Image Upload Hook ───────────────────────────────────────────────

export function useImageUpload(options: UseImageUploadOptions = {}) {
  const [preview, setPreview] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (file: File) => uploadImage(file),
    onSuccess: (url) => {
      options.onSuccess?.(url);
    },
    onError: (error: Error) => {
      if (error instanceof ImageUploadError) {
        options.onError?.(error);
      }
    },
  });

  const selectFile = useCallback(
    (file: File) => {
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(file);

      // Start upload
      mutation.mutate(file);
    },
    [mutation]
  );

  const clearPreview = useCallback(() => {
    setPreview(null);
  }, []);

  return {
    upload: mutation.mutate,
    selectFile,
    preview,
    clearPreview,
    isUploading: mutation.isPending,
    error: mutation.error,
    uploadedUrl: mutation.data,
    reset: mutation.reset,
  };
}

// ─── Multiple Image Upload Hook ─────────────────────────────────────────────

export function useMultiImageUpload(
  options: UseMultiImageUploadOptions = {}
) {
  const [previews, setPreviews] = useState<string[]>([]);

  const mutation = useMutation({
    mutationFn: (files: File[]) => uploadMultipleImages(files),
    onSuccess: (urls) => {
      options.onSuccess?.(urls);
    },
    onError: (error: Error) => {
      if (error instanceof ImageUploadError) {
        options.onError?.(error);
      }
    },
  });

  const selectFiles = useCallback(
    (files: File[]) => {
      // Create previews
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          setPreviews((prev) => [...prev, e.target?.result as string]);
        };
        reader.readAsDataURL(file);
      });

      mutation.mutate(files);
    },
    [mutation]
  );

  const clearPreviews = useCallback(() => setPreviews([]), []);

  return {
    upload: mutation.mutate,
    selectFiles,
    previews,
    clearPreviews,
    isUploading: mutation.isPending,
    error: mutation.error,
    uploadedUrls: mutation.data,
    reset: mutation.reset,
  };
}
