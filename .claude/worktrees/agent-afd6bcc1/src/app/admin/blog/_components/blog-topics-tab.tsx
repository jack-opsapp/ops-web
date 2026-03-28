"use client";

import { useState, useEffect, useCallback } from "react";

interface Topic {
  id: string;
  topic: string;
  author: string;
  used: boolean;
  created_at: string;
}

export function BlogTopicsTab() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTopic, setNewTopic] = useState("");
  const [newAuthor, setNewAuthor] = useState("The Ops Team");

  const fetchTopics = useCallback(async () => {
    try {
      const res = await fetch("/api/blog/topics");
      if (res.ok) {
        const data = await res.json();
        setTopics(data);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  async function handleCreate() {
    if (!newTopic.trim()) return;
    try {
      await fetch("/api/blog/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: newTopic.trim(), author: newAuthor.trim() || "The Ops Team" }),
      });
      setNewTopic("");
      setNewAuthor("The Ops Team");
      await fetchTopics();
    } catch {
      // silent
    }
  }

  async function handleToggleUsed(id: string, currentUsed: boolean) {
    try {
      await fetch(`/api/blog/topics/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ used: !currentUsed }),
      });
      await fetchTopics();
    } catch {
      // silent
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/blog/topics/${id}`, { method: "DELETE" });
      await fetchTopics();
    } catch {
      // silent
    }
  }

  function formatDate(date: string): string {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (loading) {
    return (
      <p className="font-kosugi text-[13px] text-[#6B6B6B]">
        Loading topics...
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Blog topic idea..."
          value={newTopic}
          onChange={(e) => setNewTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
          className="flex-1 bg-white/[0.05] border border-white/[0.1] rounded px-3 py-2 font-mohave text-[14px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:outline-none focus:border-white/[0.2]"
        />
        <input
          type="text"
          placeholder="Author"
          value={newAuthor}
          onChange={(e) => setNewAuthor(e.target.value)}
          className="w-[200px] bg-white/[0.05] border border-white/[0.1] rounded px-3 py-2 font-mohave text-[14px] text-[#E5E5E5] placeholder:text-[#6B6B6B] focus:outline-none focus:border-white/[0.2]"
        />
        <button
          type="button"
          onClick={handleCreate}
          className="px-4 py-2 bg-[#597794] hover:bg-[#6B8AA6] rounded font-mohave text-[13px] uppercase tracking-wider text-white transition-colors"
        >
          Add
        </button>
      </div>

      {/* Table */}
      {topics.length === 0 ? (
        <p className="font-kosugi text-[13px] text-[#6B6B6B]">
          No topics yet — add your first idea above
        </p>
      ) : (
        <div className="border border-white/[0.08] rounded-lg overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-5 px-6 py-3 border-b border-white/[0.08] bg-white/[0.02]">
            <span className="font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B]">
              Topic
            </span>
            <span className="font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B]">
              Author
            </span>
            <span className="font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B]">
              Used
            </span>
            <span className="font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B]">
              Created
            </span>
            <span className="font-mohave text-[12px] uppercase tracking-wider text-[#6B6B6B]">
              &nbsp;
            </span>
          </div>

          {/* Rows */}
          {topics.map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-5 px-6 items-center h-14 border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors"
            >
              <span className="font-mohave text-[14px] text-[#E5E5E5] truncate pr-4">
                {t.topic}
              </span>
              <span className="font-kosugi text-[12px] text-[#A7A7A7]">
                {t.author}
              </span>
              <span>
                <button
                  type="button"
                  onClick={() => handleToggleUsed(t.id, t.used)}
                  className={[
                    "text-[11px] font-kosugi px-2 py-0.5 rounded cursor-pointer transition-colors",
                    t.used
                      ? "bg-[#A5B368]/20 text-[#A5B368]"
                      : "bg-white/[0.05] text-[#6B6B6B]",
                  ].join(" ")}
                >
                  {t.used ? "Used" : "Unused"}
                </button>
              </span>
              <span className="font-kosugi text-[12px] text-[#A7A7A7]">
                {formatDate(t.created_at)}
              </span>
              <span>
                <button
                  type="button"
                  onClick={() => handleDelete(t.id)}
                  className="font-kosugi text-[11px] text-[#93321A] hover:text-[#B5432A] transition-colors"
                >
                  Delete
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
