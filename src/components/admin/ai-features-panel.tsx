"use client";

import { useState, useEffect, useCallback } from "react";

interface CompanyAIStatus {
  id: string;
  name: string;
  aiEmailReview: { enabled: boolean; enabledAt: string | null };
  aiEmailMemory: { enabled: boolean; enabledAt: string | null };
}

interface CompanyDetail {
  company: { id: string; name: string };
  features: {
    ai_email_review: {
      enabled: boolean;
      enabledBy: string | null;
      enabledAt: string | null;
    };
    ai_email_memory: {
      enabled: boolean;
      enabledBy: string | null;
      enabledAt: string | null;
    };
  };
  memory: {
    facts: number;
    graphEdges: number;
    profiles: number;
    writingProfiles: Array<{
      userId: string;
      emailsAnalyzed: number;
      lastUpdated: string;
    }>;
  };
}

export function AIFeaturesPanel() {
  const [companies, setCompanies] = useState<CompanyAIStatus[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<CompanyDetail | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/ai-features");
      const data = await res.json();
      setCompanies(Array.isArray(data) ? data : []);
    } catch {
      showMessage("Failed to load companies", "error");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  const selectCompany = async (companyId: string) => {
    setDetailLoading(true);
    setConfirmReset(false);
    try {
      const res = await fetch(`/api/admin/ai-features/${companyId}`);
      const data = await res.json();
      setSelectedCompany(data);
    } catch {
      showMessage("Failed to load company details", "error");
    }
    setDetailLoading(false);
  };

  const toggleFeature = async (
    companyId: string,
    feature: "ai_email_review" | "ai_email_memory",
    enabled: boolean
  ) => {
    setToggling(feature);
    try {
      const res = await fetch(`/api/admin/ai-features/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [feature]: enabled }),
      });
      if (!res.ok) throw new Error("Toggle failed");
      showMessage(
        `${feature === "ai_email_review" ? "AI Review" : "AI Memory"} ${enabled ? "enabled" : "disabled"}`,
        "success"
      );
      await selectCompany(companyId);
      await fetchCompanies();
    } catch {
      showMessage("Failed to toggle feature", "error");
    }
    setToggling(null);
  };

  const resetMemory = async (companyId: string) => {
    try {
      const res = await fetch(`/api/admin/ai-features/${companyId}/memory`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Reset failed");
      showMessage("Memory reset complete", "success");
      setConfirmReset(false);
      await selectCompany(companyId);
    } catch {
      showMessage("Failed to reset memory", "error");
    }
  };

  const filtered = companies.filter(
    (c) =>
      !searchQuery ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const enabledCount = companies.filter(
    (c) => c.aiEmailReview.enabled || c.aiEmailMemory.enabled
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-mohave text-xl font-semibold text-white">
          AI Email Features
        </h2>
        <p className="font-mohave text-sm text-[#999]">
          {enabledCount} of {companies.length} companies with AI features
          enabled
        </p>
      </div>

      {/* Status message */}
      {message && (
        <div
          className={`rounded px-3 py-2 text-sm font-mohave ${
            message.type === "success"
              ? "bg-[#9DB582]/15 text-[#9DB582] border border-[#9DB582]/20"
              : "bg-[#93321A]/15 text-[#93321A] border border-[#93321A]/20"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company list */}
        <div className="rounded border border-white/10 bg-[#0D0D0D]">
          <div className="p-4 border-b border-white/10">
            <input
              type="text"
              placeholder="Search companies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#141414] border border-white/10 rounded px-3 py-2 text-sm font-mohave text-white placeholder:text-[#999] focus:outline-none focus:border-[#597794]"
            />
          </div>

          <div className="max-h-[500px] overflow-y-auto scrollbar-hide">
            {loading ? (
              <div className="p-4 text-left text-[#999] font-mohave text-sm">
                Loading...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-left text-[#999] font-mohave text-sm">
                No companies found
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectCompany(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
                    selectedCompany?.company.id === c.id ? "bg-white/5" : ""
                  }`}
                >
                  <div className="font-mohave text-sm text-white">
                    {c.name}
                  </div>
                  <div className="flex gap-2 mt-1">
                    <span
                      className={`inline-block px-1.5 py-0.5 text-[10px] font-kosugi uppercase tracking-wider rounded ${
                        c.aiEmailReview.enabled
                          ? "bg-[#9DB582]/15 text-[#9DB582]"
                          : "bg-white/5 text-[#999]"
                      }`}
                    >
                      Review{" "}
                      {c.aiEmailReview.enabled ? "ON" : "OFF"}
                    </span>
                    <span
                      className={`inline-block px-1.5 py-0.5 text-[10px] font-kosugi uppercase tracking-wider rounded ${
                        c.aiEmailMemory.enabled
                          ? "bg-[#9DB582]/15 text-[#9DB582]"
                          : "bg-white/5 text-[#999]"
                      }`}
                    >
                      Memory{" "}
                      {c.aiEmailMemory.enabled ? "ON" : "OFF"}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Company detail */}
        <div className="rounded border border-white/10 bg-[#0D0D0D]">
          {detailLoading ? (
            <div className="p-6 text-left text-[#999] font-mohave text-sm">
              Loading...
            </div>
          ) : !selectedCompany ? (
            <div className="p-6 text-left text-[#999] font-mohave text-sm">
              Select a company to manage AI features
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <h3 className="font-mohave text-lg font-semibold text-white">
                {selectedCompany.company.name}
              </h3>

              {/* Feature toggles */}
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded border border-white/10 bg-[#141414]">
                  <div>
                    <div className="font-mohave text-sm text-white">
                      AI Email Review
                    </div>
                    <div className="font-mohave text-xs text-[#999]">
                      Ongoing classification + stage evaluation
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      toggleFeature(
                        selectedCompany.company.id,
                        "ai_email_review",
                        !selectedCompany.features.ai_email_review.enabled
                      )
                    }
                    disabled={toggling === "ai_email_review"}
                    className={`px-3 py-1.5 text-xs font-kosugi uppercase tracking-wider rounded transition-colors ${
                      selectedCompany.features.ai_email_review.enabled
                        ? "bg-[#9DB582]/15 text-[#9DB582] border border-[#9DB582]/20 hover:bg-[#93321A]/15 hover:text-[#93321A] hover:border-[#93321A]/20"
                        : "bg-white/5 text-[#999] border border-white/10 hover:bg-[#9DB582]/15 hover:text-[#9DB582] hover:border-[#9DB582]/20"
                    }`}
                  >
                    {toggling === "ai_email_review"
                      ? "..."
                      : selectedCompany.features.ai_email_review.enabled
                        ? "Enabled"
                        : "Disabled"}
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded border border-white/10 bg-[#141414]">
                  <div>
                    <div className="font-mohave text-sm text-white">
                      AI Memory
                    </div>
                    <div className="font-mohave text-xs text-[#999]">
                      Fact extraction + draft generation
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      toggleFeature(
                        selectedCompany.company.id,
                        "ai_email_memory",
                        !selectedCompany.features.ai_email_memory.enabled
                      )
                    }
                    disabled={toggling === "ai_email_memory"}
                    className={`px-3 py-1.5 text-xs font-kosugi uppercase tracking-wider rounded transition-colors ${
                      selectedCompany.features.ai_email_memory.enabled
                        ? "bg-[#9DB582]/15 text-[#9DB582] border border-[#9DB582]/20 hover:bg-[#93321A]/15 hover:text-[#93321A] hover:border-[#93321A]/20"
                        : "bg-white/5 text-[#999] border border-white/10 hover:bg-[#9DB582]/15 hover:text-[#9DB582] hover:border-[#9DB582]/20"
                    }`}
                  >
                    {toggling === "ai_email_memory"
                      ? "..."
                      : selectedCompany.features.ai_email_memory.enabled
                        ? "Enabled"
                        : "Disabled"}
                  </button>
                </div>
              </div>

              {/* Memory stats */}
              <div className="space-y-2">
                <div className="font-kosugi text-[10px] uppercase tracking-wider text-[#999]">
                  [ MEMORY STATS ]
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 rounded border border-white/10 bg-[#141414]">
                    <div className="font-mohave text-lg text-white">
                      {selectedCompany.memory.facts}
                    </div>
                    <div className="font-mohave text-[11px] text-[#999]">
                      Facts
                    </div>
                  </div>
                  <div className="p-2 rounded border border-white/10 bg-[#141414]">
                    <div className="font-mohave text-lg text-white">
                      {selectedCompany.memory.graphEdges}
                    </div>
                    <div className="font-mohave text-[11px] text-[#999]">
                      Graph Edges
                    </div>
                  </div>
                  <div className="p-2 rounded border border-white/10 bg-[#141414]">
                    <div className="font-mohave text-lg text-white">
                      {selectedCompany.memory.profiles}
                    </div>
                    <div className="font-mohave text-[11px] text-[#999]">
                      Profiles
                    </div>
                  </div>
                </div>

                {/* Writing profiles */}
                {selectedCompany.memory.writingProfiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <div className="font-kosugi text-[10px] uppercase tracking-wider text-[#999]">
                      [ WRITING PROFILES ]
                    </div>
                    {selectedCompany.memory.writingProfiles.map((wp) => (
                      <div
                        key={wp.userId}
                        className="flex items-center justify-between px-2 py-1.5 rounded bg-[#141414] border border-white/5"
                      >
                        <span className="font-mohave text-xs text-white truncate max-w-[180px]">
                          {wp.userId}
                        </span>
                        <span className="font-mohave text-xs text-[#999]">
                          {wp.emailsAnalyzed} emails
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reset button */}
              <div className="pt-2 border-t border-white/10">
                {!confirmReset ? (
                  <button
                    onClick={() => setConfirmReset(true)}
                    className="px-3 py-1.5 text-xs font-kosugi uppercase tracking-wider rounded border border-[#93321A]/20 text-[#93321A] bg-[#93321A]/10 hover:bg-[#93321A]/20 transition-colors"
                  >
                    Reset Memory
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-mohave text-xs text-[#93321A]">
                      This will delete all facts, edges, and profiles.
                    </span>
                    <button
                      onClick={() =>
                        resetMemory(selectedCompany.company.id)
                      }
                      className="px-3 py-1.5 text-xs font-kosugi uppercase tracking-wider rounded bg-[#93321A] text-white hover:bg-[#93321A]/80 transition-colors"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmReset(false)}
                      className="px-3 py-1.5 text-xs font-kosugi uppercase tracking-wider rounded border border-white/10 text-[#999] hover:bg-white/5 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
