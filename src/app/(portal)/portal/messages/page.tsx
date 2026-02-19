"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, MessageSquare } from "lucide-react";

interface PortalMessage {
  id: string;
  senderType: "client" | "company";
  senderName: string;
  content: string;
  readAt: string | null;
  createdAt: string;
}

function formatMessageTime(date: string): string {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateGroupLabel(date: string): string {
  const messageDate = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  // Compare date-only (strip time)
  const msgDay = messageDate.toDateString();
  const todayStr = today.toDateString();
  const yesterdayStr = yesterday.toDateString();

  if (msgDay === todayStr) return "Today";
  if (msgDay === yesterdayStr) return "Yesterday";

  return messageDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: messageDate.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

function groupMessagesByDate(messages: PortalMessage[]): Map<string, PortalMessage[]> {
  const groups = new Map<string, PortalMessage[]>();
  for (const msg of messages) {
    const dateKey = new Date(msg.createdAt).toDateString();
    const existing = groups.get(dateKey);
    if (existing) {
      existing.push(msg);
    } else {
      groups.set(dateKey, [msg]);
    }
  }
  return groups;
}

export default function MessagesPage() {
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();

  const { data: messages, isLoading, error } = useQuery<PortalMessage[]>({
    queryKey: ["portal", "messages"],
    queryFn: async () => {
      const res = await fetch("/api/portal/messages?limit=100", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    refetchInterval: 15000, // Poll for new messages every 15 seconds
  });

  const sendMutation = useMutation<PortalMessage, Error, string>({
    mutationFn: async (content: string) => {
      const res = await fetch("/api/portal/messages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error("Failed to send message");
      return res.json();
    },
    onSuccess: () => {
      setNewMessage("");
      queryClient.invalidateQueries({ queryKey: ["portal", "messages"] });
      queryClient.invalidateQueries({ queryKey: ["portal", "data"] });
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    },
  });

  // Auto-scroll to bottom on load and when new messages arrive
  useEffect(() => {
    if (messages && messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  function handleSend() {
    const trimmed = newMessage.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Send on Enter (without Shift)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Auto-resize textarea
  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setNewMessage(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2
          className="w-8 h-8 animate-spin"
          style={{ color: "var(--portal-accent)" }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "var(--portal-text-secondary)" }}>
          Unable to load messages. Please try refreshing.
        </p>
      </div>
    );
  }

  const messageList = messages ?? [];
  const dateGroups = groupMessagesByDate(messageList);

  return (
    <div
      className="flex flex-col"
      style={{
        height: "calc(100vh - 180px)", // Account for header, padding, and bottom nav
        minHeight: "400px",
      }}
    >
      {/* Messages header */}
      <div className="mb-4">
        <h1
          className="text-xl"
          style={{
            fontFamily: "var(--portal-heading-font)",
            fontWeight: "var(--portal-heading-weight)",
            textTransform: "var(--portal-heading-transform)" as React.CSSProperties["textTransform"],
          }}
        >
          Messages
        </h1>
      </div>

      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto rounded-xl"
        style={{
          backgroundColor: "var(--portal-bg-secondary)",
          border: "1px solid var(--portal-border)",
          borderRadius: "var(--portal-radius-lg)",
        }}
      >
        {messageList.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full py-16 px-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: "var(--portal-card)" }}
            >
              <MessageSquare
                className="w-8 h-8"
                style={{ color: "var(--portal-text-tertiary)" }}
              />
            </div>
            <p
              className="text-base font-medium mb-1"
              style={{
                fontFamily: "var(--portal-heading-font)",
                fontWeight: "var(--portal-heading-weight)",
              }}
            >
              No messages yet
            </p>
            <p
              className="text-sm text-center max-w-xs"
              style={{ color: "var(--portal-text-tertiary)" }}
            >
              Send a message below and your service provider will be notified.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {Array.from(dateGroups.entries()).map(([dateKey, msgs]) => (
              <div key={dateKey}>
                {/* Date separator */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--portal-border)" }} />
                  <span
                    className="text-xs font-medium px-2 shrink-0"
                    style={{ color: "var(--portal-text-tertiary)" }}
                  >
                    {formatDateGroupLabel(msgs[0].createdAt)}
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: "var(--portal-border)" }} />
                </div>

                {/* Messages in this date group */}
                <div className="space-y-3">
                  {msgs.map((msg) => {
                    const isClient = msg.senderType === "client";
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isClient ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className="max-w-[80%] sm:max-w-[70%]"
                        >
                          {/* Sender name (for company messages) */}
                          {!isClient && (
                            <p
                              className="text-xs mb-1 ml-1"
                              style={{ color: "var(--portal-text-tertiary)" }}
                            >
                              {msg.senderName}
                            </p>
                          )}

                          {/* Message bubble */}
                          <div
                            className="px-4 py-2.5 rounded-2xl"
                            style={{
                              backgroundColor: isClient
                                ? "var(--portal-accent)"
                                : "var(--portal-card)",
                              color: isClient
                                ? "var(--portal-accent-text)"
                                : "var(--portal-text)",
                              borderBottomRightRadius: isClient ? "4px" : undefined,
                              borderBottomLeftRadius: !isClient ? "4px" : undefined,
                            }}
                          >
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">
                              {msg.content}
                            </p>
                          </div>

                          {/* Timestamp */}
                          <p
                            className={`text-[10px] mt-1 ${isClient ? "text-right mr-1" : "ml-1"}`}
                            style={{ color: "var(--portal-text-tertiary)" }}
                          >
                            {formatMessageTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Message input */}
      <div
        className="mt-3 flex items-end gap-2 p-3 rounded-xl"
        style={{
          backgroundColor: "var(--portal-card)",
          border: "1px solid var(--portal-border)",
          borderRadius: "var(--portal-radius-lg)",
        }}
      >
        <textarea
          ref={textareaRef}
          value={newMessage}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={sendMutation.isPending}
          className="flex-1 resize-none text-sm bg-transparent outline-none py-2 px-1"
          style={{
            color: "var(--portal-text)",
            maxHeight: 120,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!newMessage.trim() || sendMutation.isPending}
          className="shrink-0 p-2.5 rounded-lg transition-colors"
          style={{
            backgroundColor: newMessage.trim() && !sendMutation.isPending
              ? "var(--portal-accent)"
              : "transparent",
            color: newMessage.trim() && !sendMutation.isPending
              ? "var(--portal-accent-text)"
              : "var(--portal-text-tertiary)",
            borderRadius: "var(--portal-radius-sm)",
            cursor: newMessage.trim() && !sendMutation.isPending ? "pointer" : "default",
          }}
          aria-label="Send message"
        >
          {sendMutation.isPending ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Send error */}
      {sendMutation.isError && (
        <p
          className="text-xs mt-1 text-center"
          style={{ color: "var(--portal-error)" }}
        >
          Failed to send message. Please try again.
        </p>
      )}
    </div>
  );
}
