"use client";

import { useRef, useCallback } from "react";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
}

export function RichTextEditor({ value, onChange }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exec = useCallback(
    (command: string, val?: string) => {
      document.execCommand(command, false, val);
      if (editorRef.current) {
        onChange(editorRef.current.innerHTML);
      }
    },
    [onChange]
  );

  const handleFormat = useCallback(
    (
      e: React.MouseEvent<HTMLButtonElement>,
      command: string,
      cmdValue?: string
    ) => {
      e.preventDefault();
      exec(command, cmdValue);
    },
    [exec]
  );

  const handleHeading = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, tag: "H2" | "H3") => {
      e.preventDefault();
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const node = selection.anchorNode;
        const parentEl =
          node?.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : node?.parentElement;
        const block = parentEl?.closest("h2, h3, p, div");
        if (block && block.tagName === tag) {
          exec("formatBlock", "P");
        } else {
          exec("formatBlock", tag);
        }
      } else {
        exec("formatBlock", tag);
      }
    },
    [exec]
  );

  const handleLink = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const url = prompt("Enter URL:");
      if (url) {
        exec("createLink", url);
      }
    },
    [exec]
  );

  const handleImage = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const url = prompt("Enter image URL:");
      if (url) {
        exec("insertImage", url);
      }
    },
    [exec]
  );

  const handleUploadClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      fileInputRef.current?.click();
    },
    []
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const objectUrl = URL.createObjectURL(file);
        exec("insertImage", objectUrl);
      }
      // Reset input so same file can be re-selected
      e.target.value = "";
    },
    [exec]
  );

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const btnClass =
    "px-2.5 py-1.5 rounded text-[13px] font-mono text-[#A7A7A7] hover:bg-white/[0.05] hover:text-[#E5E5E5]";
  const divider = "w-px h-5 bg-white/[0.1] mx-1";

  return (
    <div className="border border-white/[0.1] rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-white/[0.08] bg-white/[0.02]">
        {/* Headings */}
        <button
          type="button"
          className={btnClass}
          onMouseDown={(e) => handleHeading(e, "H2")}
        >
          H2
        </button>
        <button
          type="button"
          className={btnClass}
          onMouseDown={(e) => handleHeading(e, "H3")}
        >
          H3
        </button>

        <div className={divider} />

        {/* Inline */}
        <button
          type="button"
          className={btnClass}
          onMouseDown={(e) => handleFormat(e, "bold")}
        >
          B
        </button>
        <button
          type="button"
          className={btnClass}
          onMouseDown={(e) => handleFormat(e, "italic")}
        >
          I
        </button>

        <div className={divider} />

        {/* Link & Images */}
        <button
          type="button"
          className={btnClass}
          onMouseDown={handleLink}
        >
          Link
        </button>
        <button
          type="button"
          className={btnClass}
          onMouseDown={handleImage}
        >
          IMG
        </button>
        <button
          type="button"
          className={btnClass}
          onMouseDown={handleUploadClick}
        >
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className={divider} />

        {/* Lists */}
        <button
          type="button"
          className={btnClass}
          onMouseDown={(e) => handleFormat(e, "insertUnorderedList")}
        >
          UL
        </button>
        <button
          type="button"
          className={btnClass}
          onMouseDown={(e) => handleFormat(e, "insertOrderedList")}
        >
          OL
        </button>

        <div className={divider} />

        {/* Blockquote */}
        <button
          type="button"
          className={btnClass}
          onMouseDown={(e) => handleFormat(e, "formatBlock", "BLOCKQUOTE")}
        >
          BQ
        </button>
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className={[
          "min-h-[400px] p-6 font-kosugi text-[15px] text-[#E5E5E5] leading-relaxed focus:outline-none",
          "[&_h2]:font-mohave [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[#E5E5E5] [&_h2]:mt-8 [&_h2]:mb-3",
          "[&_h3]:font-mohave [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[#E5E5E5] [&_h3]:mt-6 [&_h3]:mb-2",
          "[&_p]:mb-4",
          "[&_a]:text-[#597794] [&_a]:underline",
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4",
          "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4",
          "[&_li]:mb-1",
          "[&_blockquote]:border-l-2 [&_blockquote]:border-[#597794] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[#A7A7A7] [&_blockquote]:my-4",
          "[&_img]:max-w-full [&_img]:rounded [&_img]:my-4",
        ].join(" ")}
        dangerouslySetInnerHTML={{ __html: value }}
        onInput={handleInput}
      />
    </div>
  );
}
