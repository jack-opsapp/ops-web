"use client";

import { useState, useCallback } from "react";
import { Mail, MessageSquareText, Paperclip, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useDictionary } from "@/i18n/client";

interface UnifiedReplyBarProps {
  defaultChannel: "email" | "portal";
  onSendPortal: (content: string) => void;
  onSendEmail: () => void;
  isSending: boolean;
  hasEmailThreads: boolean;
  hasPortalMessages: boolean;
}

export function UnifiedReplyBar({
  defaultChannel,
  onSendPortal,
  onSendEmail,
  isSending,
  hasEmailThreads,
  hasPortalMessages,
}: UnifiedReplyBarProps) {
  const { t } = useDictionary("inbox");
  const [channel, setChannel] = useState<"email" | "portal">(defaultChannel);
  const [message, setMessage] = useState("");
  const [showChannelPicker, setShowChannelPicker] = useState(false);

  const handleSend = useCallback(() => {
    if (!message.trim()) return;

    if (channel === "portal") {
      onSendPortal(message.trim());
      setMessage("");
    } else {
      // Email opens the compose modal
      onSendEmail();
    }
  }, [channel, message, onSendPortal, onSendEmail]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="px-3.5 py-2.5 border-t border-border-subtle bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2]">
      <div className="flex items-center gap-2">
        {/* Channel selector */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowChannelPicker((prev) => !prev)}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-[3px] font-kosugi text-micro uppercase tracking-wider cursor-pointer transition-colors",
              channel === "portal"
                ? "bg-ops-accent-muted text-ops-accent"
                : "bg-surface-input text-text-3"
            )}
          >
            {channel === "portal" ? (
              <MessageSquareText className="w-3.5 h-3.5" />
            ) : (
              <Mail className="w-3.5 h-3.5" />
            )}
            {channel === "portal" ? t("reply.viaPortal") : t("reply.viaEmail")}
            <ChevronDown className="w-3 h-3" />
          </button>

          {showChannelPicker && (
            <div className="absolute bottom-full left-0 mb-1 bg-glass glass-surface backdrop-blur-[20px] saturate-[1.2] border border-border-subtle rounded-[3px] overflow-hidden z-20">
              {hasPortalMessages && (
                <button
                  onClick={() => {
                    setChannel("portal");
                    setShowChannelPicker(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 w-full text-left hover:bg-surface-input transition-colors"
                >
                  <MessageSquareText className="w-3.5 h-3.5 text-ops-accent" />
                  <span className="font-kosugi text-micro text-text-2 uppercase">
                    {t("reply.viaPortal")}
                  </span>
                </button>
              )}
              {hasEmailThreads && (
                <button
                  onClick={() => {
                    setChannel("email");
                    setShowChannelPicker(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 w-full text-left hover:bg-surface-input transition-colors"
                >
                  <Mail className="w-3.5 h-3.5 text-text-3" />
                  <span className="font-kosugi text-micro text-text-2 uppercase">
                    {t("reply.viaEmail")}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Text input */}
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("reply.placeholder")}
          disabled={isSending}
          className="flex-1 bg-surface-input border border-border-subtle rounded-[3px] px-3 py-2 font-mohave text-body-sm text-text placeholder:text-text-3 outline-none disabled:opacity-50"
        />

        {/* Attach + Send */}
        <div className="flex items-center gap-1 shrink-0">
          <button className="w-[28px] h-[28px] flex items-center justify-center rounded-[3px] text-text-mute hover:text-text-2 transition-colors">
            <Paperclip className="w-[14px] h-[14px]" />
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !message.trim()}
            className="bg-ops-accent text-white px-3.5 py-1.5 rounded-[3px] font-kosugi text-micro uppercase tracking-[0.3px] hover:bg-ops-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("reply.send")}
          </button>
        </div>
      </div>
    </div>
  );
}
