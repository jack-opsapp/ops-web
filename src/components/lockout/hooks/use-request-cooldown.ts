import { useCallback, useEffect, useState } from "react";

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const KEY_PREFIX = "ops-lockout-request-";

type CooldownReason = "subscription_expired" | "unseated";

interface StoredRecord {
  timestamp: number;
  reason: CooldownReason;
}

function readRecord(userId: string): StoredRecord | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(`${KEY_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredRecord;
    if (typeof parsed.timestamp !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isWithinWindow(record: StoredRecord, now: number): boolean {
  return now - record.timestamp < COOLDOWN_MS;
}

export function useRequestCooldown(userId: string) {
  const compute = useCallback(() => {
    const record = readRecord(userId);
    if (!record) return { isActive: false, sentAt: null as Date | null };
    const active = isWithinWindow(record, Date.now());
    return {
      isActive: active,
      sentAt: active ? new Date(record.timestamp) : null,
    };
  }, [userId]);

  const [state, setState] = useState(compute);

  useEffect(() => {
    setState(compute());
  }, [compute]);

  const setCooldown = useCallback(
    (reason: CooldownReason) => {
      if (typeof window === "undefined") return;
      const record: StoredRecord = { timestamp: Date.now(), reason };
      localStorage.setItem(`${KEY_PREFIX}${userId}`, JSON.stringify(record));
      setState({ isActive: true, sentAt: new Date(record.timestamp) });
    },
    [userId]
  );

  return { isActive: state.isActive, sentAt: state.sentAt, setCooldown };
}
