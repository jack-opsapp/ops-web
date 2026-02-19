"use client";

import { Send, ImageIcon, X, Loader2, Pencil } from "lucide-react";
import { useState, useRef } from "react";
import { MentionTextArea, extractMentionedUserIds } from "@/components/ops/mention-textarea";
import { PhotoCaptionDialog } from "@/components/ops/photo-caption-dialog";
import { PhotoMarkupDialog } from "@/components/ops/photo-markup/photo-markup-dialog";
import { uploadImage } from "@/lib/api/services/image-service";
import { toast } from "sonner";
import type { User } from "@/lib/types/models";
import type { NoteAttachment } from "@/lib/types/pipeline";

interface NoteComposerProps {
  onSubmit: (
    content: string,
    mentionedUserIds: string[],
    attachments: NoteAttachment[]
  ) => void;
  isSubmitting?: boolean;
  placeholder?: string;
  users: User[];
  initialContent?: string;
  initialAttachments?: NoteAttachment[];
  onCancel?: () => void;
}

export function NoteComposer({
  onSubmit,
  isSubmitting,
  placeholder = "Write a note... (type @ to mention someone)",
  users,
  initialContent,
  initialAttachments,
  onCancel,
}: NoteComposerProps) {
  const [content, setContent] = useState(initialContent ?? "");
  const [attachments, setAttachments] = useState<NoteAttachment[]>(
    initialAttachments ?? []
  );
  const [uploadingCount, setUploadingCount] = useState(0);
  const [captionTarget, setCaptionTarget] = useState<number | null>(null);
  const [markupTarget, setMarkupTarget] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSubmit =
    (content.trim().length > 0 || attachments.length > 0) &&
    !isSubmitting &&
    uploadingCount === 0;

  function handleSubmit() {
    if (!canSubmit) return;
    const trimmed = content.trim();
    const mentionedIds = extractMentionedUserIds(trimmed);
    onSubmit(trimmed, mentionedIds, attachments);
    setContent("");
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploadingCount((c) => c + files.length);
    for (const file of files) {
      try {
        const url = await uploadImage(file);
        setAttachments((prev) => [
          ...prev,
          { url, caption: null, markedUpUrl: null },
        ]);
      } catch {
        toast.error(`Failed to upload ${file.name}`);
      } finally {
        setUploadingCount((c) => c - 1);
      }
    }
    e.target.value = "";
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <MentionTextArea
        value={content}
        onChange={setContent}
        users={users}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        textareaRef={textareaRef}
      />

      {/* Attachment previews */}
      {(attachments.length > 0 || uploadingCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {attachments.map((att, i) => (
            <button
              key={i}
              onClick={() => setCaptionTarget(i)}
              className="group/att relative"
            >
              <img
                src={att.markedUpUrl ?? att.url}
                alt={att.caption ?? "Attachment"}
                className="h-20 w-20 rounded-lg object-cover"
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAttachments((prev) => prev.filter((_, j) => j !== i));
                }}
                className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-0.5 text-white opacity-0 transition group-hover/att:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMarkupTarget(i);
                }}
                className="absolute bottom-1 left-1 rounded bg-black/60 p-1 text-white opacity-0 transition group-hover/att:opacity-100"
                title="Mark up photo"
              >
                <Pencil className="h-3 w-3" />
              </button>
              {att.caption && (
                <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/70 px-1 py-0.5">
                  <span className="text-[10px] text-[#E5E5E5] line-clamp-1">
                    {att.caption}
                  </span>
                </div>
              )}
            </button>
          ))}
          {uploadingCount > 0 && (
            <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-white/20">
              <Loader2 className="h-5 w-5 animate-spin text-[#999]" />
            </div>
          )}
        </div>
      )}

      {/* Caption dialog */}
      {captionTarget !== null && attachments[captionTarget] && (
        <PhotoCaptionDialog
          open={true}
          onOpenChange={() => setCaptionTarget(null)}
          imageUrl={attachments[captionTarget].url}
          initialCaption={attachments[captionTarget].caption}
          onSave={(caption) => {
            setAttachments((prev) =>
              prev.map((att, j) =>
                j === captionTarget ? { ...att, caption } : att
              )
            );
            setCaptionTarget(null);
          }}
        />
      )}

      {/* Markup dialog */}
      {markupTarget !== null && attachments[markupTarget] && (
        <PhotoMarkupDialog
          open={true}
          onOpenChange={() => setMarkupTarget(null)}
          imageUrl={attachments[markupTarget].url}
          onSave={(markedUpUrl) => {
            setAttachments((prev) =>
              prev.map((att, j) =>
                j === markupTarget ? { ...att, markedUpUrl } : att
              )
            );
            setMarkupTarget(null);
          }}
        />
      )}

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded p-1.5 text-[#999] transition hover:bg-white/10 hover:text-[#E5E5E5]"
            title="Attach photos"
          >
            <ImageIcon className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#666]">
            {(content.length > 0 || attachments.length > 0) && "Ctrl+Enter to send"}
          </span>
          {onCancel && (
            <button
              onClick={onCancel}
              className="rounded-md px-3 py-1.5 text-xs text-[#999] hover:text-[#E5E5E5]"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 rounded-md bg-[#417394] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#4d8ab0] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="h-3.5 w-3.5" />
            {onCancel ? "Save" : "Post"}
          </button>
        </div>
      </div>
    </div>
  );
}
