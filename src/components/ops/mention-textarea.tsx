"use client";

import { useState, useRef, useCallback } from "react";
import { UserAvatar } from "@/components/ops/user-avatar";
import type { User } from "@/lib/types/models";

// --- Mention Parsing Utilities ---

const MENTION_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/g;

export function extractMentionedUserIds(text: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const regex = new RegExp(MENTION_PATTERN.source, "g");
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[2]);
  }
  return Array.from(ids);
}

export function parseMentions(
  text: string
): Array<
  | { type: "text"; value: string }
  | { type: "mention"; name: string; userId: string }
> {
  const parts: Array<
    | { type: "text"; value: string }
    | { type: "mention"; name: string; userId: string }
  > = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(MENTION_PATTERN.source, "g");

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "mention", name: match[1], userId: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }
  return parts;
}

// --- Component ---

interface MentionTextAreaProps {
  value: string;
  onChange: (value: string) => void;
  users: User[];
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function MentionTextArea({
  value,
  onChange,
  users,
  placeholder,
  onKeyDown,
  textareaRef: externalRef,
}: MentionTextAreaProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const ref = externalRef ?? internalRef;

  const filteredUsers = users
    .filter((u) => {
      const name = `${u.firstName} ${u.lastName}`.toLowerCase();
      return name.includes(suggestionQuery.toLowerCase());
    })
    .slice(0, 5);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursor = e.target.selectionStart ?? 0;
      onChange(newValue);
      setCursorPosition(cursor);

      // Auto-resize
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";

      // Check if we should show mention suggestions
      const textBeforeCursor = newValue.slice(0, cursor);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex >= 0) {
        const charBefore =
          atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";
        const textAfterAt = textBeforeCursor.slice(atIndex + 1);
        if (
          (charBefore === " " || charBefore === "\n" || atIndex === 0) &&
          !textAfterAt.includes("\n") &&
          textAfterAt.length < 30
        ) {
          setSuggestionQuery(textAfterAt);
          setShowSuggestions(true);
          setSuggestionIndex(0);
          return;
        }
      }
      setShowSuggestions(false);
    },
    [onChange]
  );

  function insertMention(user: User) {
    const textBeforeCursor = value.slice(0, cursorPosition);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    const textBefore = value.slice(0, atIndex);
    const textAfter = value.slice(cursorPosition);
    const mention = `@[${user.firstName} ${user.lastName}](${user.id})`;
    const newValue = textBefore + mention + " " + textAfter;
    onChange(newValue);
    setShowSuggestions(false);

    requestAnimationFrame(() => {
      if (ref.current) {
        const newCursor = textBefore.length + mention.length + 1;
        ref.current.focus();
        ref.current.setSelectionRange(newCursor, newCursor);
      }
    });
  }

  function handleKeyDownInternal(e: React.KeyboardEvent) {
    if (showSuggestions && filteredUsers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSuggestionIndex((i) =>
          Math.min(i + 1, filteredUsers.length - 1)
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSuggestionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(filteredUsers[suggestionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }
    onKeyDown?.(e);
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDownInternal}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent text-sm text-[#E5E5E5] placeholder:text-[#666] focus:outline-none"
      />

      {showSuggestions && filteredUsers.length > 0 && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border border-white/10 bg-[#1a1a1a] py-1 shadow-xl">
          {filteredUsers.map((user, i) => (
            <button
              key={user.id}
              onClick={() => insertMention(user)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                i === suggestionIndex
                  ? "bg-[#417394]/20 text-[#E5E5E5]"
                  : "text-[#999] hover:bg-white/5"
              }`}
            >
              <UserAvatar
                name={`${user.firstName} ${user.lastName}`}
                imageUrl={user.profileImageURL ?? null}
                size="sm"
                color={user.userColor ?? undefined}
              />
              <span>
                {user.firstName} {user.lastName}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
