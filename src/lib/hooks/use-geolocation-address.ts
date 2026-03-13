"use client";

import { useState, useCallback } from "react";

interface GeolocationAddressState {
  loading: boolean;
  error: string | null;
}

/**
 * Hook that gets the user's current position via browser geolocation,
 * then reverse-geocodes it to a street address using OpenStreetMap Nominatim.
 *
 * Returns { getAddress, loading, error }.
 * `getAddress()` resolves with the formatted address string or null on failure.
 */
export function useGeolocationAddress() {
  const [state, setState] = useState<GeolocationAddressState>({
    loading: false,
    error: null,
  });

  const getAddress = useCallback(async (): Promise<string | null> => {
    if (!navigator.geolocation) {
      setState({ loading: false, error: "Geolocation not supported" });
      return null;
    }

    setState({ loading: true, error: null });

    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000,
          });
        }
      );

      const { latitude, longitude } = position.coords;

      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
        {
          headers: {
            "Accept-Language": "en",
            "User-Agent": "OPS-Web/1.0 (https://opsapp.co)",
          },
        }
      );

      if (!res.ok) {
        setState({ loading: false, error: "Could not determine address" });
        return null;
      }

      const data = await res.json();
      const addr = data.address;

      if (!addr) {
        setState({ loading: false, error: "No address found" });
        return null;
      }

      // Build a clean address: street, city, state ZIP
      const parts: string[] = [];

      const street = [addr.house_number, addr.road].filter(Boolean).join(" ");
      if (street) parts.push(street);

      const city = addr.city || addr.town || addr.village || addr.hamlet;
      if (city) parts.push(city);

      const state_name = addr.state;
      const postcode = addr.postcode;
      if (state_name && postcode) {
        parts.push(`${state_name} ${postcode}`);
      } else if (state_name) {
        parts.push(state_name);
      }

      const formatted = parts.join(", ");

      setState({ loading: false, error: null });
      return formatted || data.display_name || null;
    } catch (err) {
      const message =
        err instanceof GeolocationPositionError
          ? err.code === 1
            ? "Location permission denied"
            : "Could not determine location"
          : "Location lookup failed";

      setState({ loading: false, error: message });
      return null;
    }
  }, []);

  return {
    getAddress,
    loading: state.loading,
    error: state.error,
  };
}
