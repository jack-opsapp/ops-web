"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronDown, ChevronRight, Plus, Trash2, Edit2, Check, X,
  Eye, EyeOff, Clock, Rocket, FlaskConical,
  PackageCheck, CheckCircle2, Lightbulb,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WhatsNewItem {
  id: string;
  category_id: string;
  title: string;
  description: string;
  icon: string;
  status: string;
  feature_flag_slug: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface WhatsNewCategory {
  id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  whats_new_items: WhatsNewItem[];
}

interface BetaRequest {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  company_id: string;
  company_name: string;
  whats_new_item_id: string;
  status: string;
  admin_notes: string | null;
  requested_at: string;
  reviewed_at: string | null;
  whats_new_items: { title: string; description: string; feature_flag_slug: string | null } | null;
}

const STATUS_OPTIONS = [
  { value: "planned", label: "Planned", icon: Lightbulb, color: "#6B6B6B" },
  { value: "in_development", label: "In Development", icon: Clock, color: "#E5E5E5" },
  { value: "in_testing", label: "In Testing", icon: FlaskConical, color: "#C4A868" },
  { value: "coming_soon", label: "Coming Soon", icon: Rocket, color: "#8195B5" },
  { value: "shipped", label: "Shipped", icon: PackageCheck, color: "#9DB582" },
  { value: "completed", label: "Completed", icon: CheckCircle2, color: "#9DB582" },
];

// ─── Main Component ──────────────────────────────────────────────────────────

export function WhatsNewContent() {
  const [categories, setCategories] = useState<WhatsNewCategory[]>([]);
  const [requests, setRequests] = useState<BetaRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [addingItemToCat, setAddingItemToCat] = useState<string | null>(null);
  const [requestFilter, setRequestFilter] = useState<string>("pending");
  const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState("");

  const showMsg = useCallback((text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [catRes, reqRes] = await Promise.all([
        fetch("/api/admin/whats-new/categories"),
        fetch("/api/admin/whats-new/requests"),
      ]);
      if (catRes.ok) setCategories(await catRes.json());
      if (reqRes.ok) setRequests(await reqRes.json());
    } catch {
      showMsg("Failed to load data", "error");
    } finally {
      setLoading(false);
    }
  }, [showMsg]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Category CRUD ──

  const createCategory = async (name: string, icon: string) => {
    const maxSort = Math.max(0, ...categories.map((c) => c.sort_order));
    const res = await fetch("/api/admin/whats-new/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, icon, sort_order: maxSort + 1 }),
    });
    if (!res.ok) { showMsg("Failed to create category", "error"); return; }
    showMsg(`Created "${name}"`, "success");
    setShowNewCategory(false);
    fetchAll();
  };

  const updateCategory = async (id: string, updates: Partial<WhatsNewCategory>) => {
    const res = await fetch("/api/admin/whats-new/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!res.ok) { showMsg("Failed to update", "error"); return; }
    showMsg("Updated", "success");
    setEditingCat(null);
    fetchAll();
  };

  const deleteCategory = async (id: string) => {
    if (!confirm("Delete this category and all its items?")) return;
    const res = await fetch("/api/admin/whats-new/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) { showMsg("Failed to delete", "error"); return; }
    showMsg("Deleted", "success");
    fetchAll();
  };

  // ── Item CRUD ──

  const createItem = async (categoryId: string, title: string, description: string, icon: string, status: string, featureFlagSlug: string) => {
    const cat = categories.find((c) => c.id === categoryId);
    const maxSort = Math.max(0, ...(cat?.whats_new_items ?? []).map((i) => i.sort_order));
    const res = await fetch("/api/admin/whats-new/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category_id: categoryId,
        title,
        description,
        icon,
        status,
        feature_flag_slug: featureFlagSlug || null,
        sort_order: maxSort + 1,
      }),
    });
    if (!res.ok) { showMsg("Failed to create item", "error"); return; }
    showMsg(`Created "${title}"`, "success");
    setAddingItemToCat(null);
    fetchAll();
  };

  const updateItem = async (id: string, updates: Partial<WhatsNewItem>) => {
    const res = await fetch("/api/admin/whats-new/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    });
    if (!res.ok) { showMsg("Failed to update", "error"); return; }
    showMsg("Updated", "success");
    setEditingItem(null);
    fetchAll();
  };

  const deleteItem = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    const res = await fetch("/api/admin/whats-new/items", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) { showMsg("Failed to delete", "error"); return; }
    showMsg("Deleted", "success");
    fetchAll();
  };

  // ── Request management ──

  const handleRequestDecision = async (requestId: string, status: "approved" | "rejected") => {
    const res = await fetch("/api/admin/whats-new/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requestId, status, admin_notes: adminNotes || null }),
    });
    if (!res.ok) { showMsg("Failed to process request", "error"); return; }
    showMsg(status === "approved" ? "Approved — email sent" : "Rejected — email sent", "success");
    setExpandedRequest(null);
    setAdminNotes("");
    fetchAll();
  };

  const filteredRequests = requests.filter((r) =>
    requestFilter === "all" ? true : r.status === requestFilter
  );

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="font-mohave text-[14px] uppercase tracking-widest text-[#6B6B6B] animate-pulse">
          Loading...
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Message toast */}
      {message && (
        <div className={`px-4 py-2 rounded-lg text-[13px] font-mohave ${
          message.type === "success" ? "bg-[#9DB582]/20 text-[#9DB582]" : "bg-[#93321A]/20 text-[#93321A]"
        }`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-[1fr_400px] gap-6">
        {/* ── Left: Categories & Items ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mohave text-[14px] uppercase tracking-widest text-[#E5E5E5]">
              Categories & Items
            </h2>
            <span className="font-kosugi text-[12px] text-[#6B6B6B]">
              {categories.length} categories · {categories.reduce((sum, c) => sum + c.whats_new_items.length, 0)} items
            </span>
          </div>

          {categories.map((cat) => (
            <CategoryCard
              key={cat.id}
              category={cat}
              isExpanded={expandedCats.has(cat.id)}
              onToggleExpand={() => {
                setExpandedCats((prev) => {
                  const next = new Set(prev);
                  next.has(cat.id) ? next.delete(cat.id) : next.add(cat.id);
                  return next;
                });
              }}
              editingCat={editingCat}
              setEditingCat={setEditingCat}
              onUpdateCategory={updateCategory}
              onDeleteCategory={deleteCategory}
              editingItem={editingItem}
              setEditingItem={setEditingItem}
              onUpdateItem={updateItem}
              onDeleteItem={deleteItem}
              addingItemToCat={addingItemToCat}
              setAddingItemToCat={setAddingItemToCat}
              onCreateItem={createItem}
            />
          ))}

          {/* Add category */}
          {showNewCategory ? (
            <NewCategoryForm
              onSubmit={createCategory}
              onCancel={() => setShowNewCategory(false)}
            />
          ) : (
            <button
              onClick={() => setShowNewCategory(true)}
              className="flex items-center gap-2 px-4 py-3 w-full border border-dashed border-white/[0.12] rounded-lg text-[#6B6B6B] hover:text-[#E5E5E5] hover:border-white/[0.2] transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="font-mohave text-[13px] uppercase tracking-wider">Add Category</span>
            </button>
          )}
        </div>

        {/* ── Right: Beta Access Requests ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mohave text-[14px] uppercase tracking-widest text-[#E5E5E5]">
              Beta Requests
              {pendingCount > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-[#C4A868]/20 text-[#C4A868] text-[11px] rounded">
                  {pendingCount} pending
                </span>
              )}
            </h2>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 mb-3">
            {["pending", "approved", "rejected", "all"].map((f) => (
              <button
                key={f}
                onClick={() => setRequestFilter(f)}
                className={`px-3 py-1.5 font-mohave text-[11px] uppercase tracking-wider rounded transition-colors ${
                  requestFilter === f
                    ? "bg-white/[0.08] text-[#E5E5E5]"
                    : "text-[#6B6B6B] hover:text-[#A0A0A0]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {filteredRequests.length === 0 ? (
            <p className="font-kosugi text-[12px] text-[#6B6B6B] py-8 text-center">
              No {requestFilter === "all" ? "" : requestFilter} requests.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredRequests.map((req) => (
                <div key={req.id} className="border border-white/[0.08] rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedRequest(expandedRequest === req.id ? null : req.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="text-left min-w-0">
                      <div className="font-mohave text-[13px] text-[#E5E5E5] truncate">
                        {req.user_name}
                      </div>
                      <div className="font-kosugi text-[11px] text-[#6B6B6B] truncate">
                        {req.company_name} · {req.whats_new_items?.title ?? "Unknown"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`font-mohave text-[10px] uppercase tracking-widest ${
                        req.status === "pending" ? "text-[#C4A868]" :
                        req.status === "approved" ? "text-[#9DB582]" : "text-[#93321A]"
                      }`}>
                        {req.status}
                      </span>
                      {expandedRequest === req.id ? <ChevronDown className="w-3 h-3 text-[#6B6B6B]" /> : <ChevronRight className="w-3 h-3 text-[#6B6B6B]" />}
                    </div>
                  </button>

                  {expandedRequest === req.id && (
                    <div className="border-t border-white/[0.06] px-4 py-4 space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-[12px]">
                        <div>
                          <span className="font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B]">Email</span>
                          <p className="font-kosugi text-[#A0A0A0]">{req.user_email}</p>
                        </div>
                        <div>
                          <span className="font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B]">Company</span>
                          <p className="font-kosugi text-[#A0A0A0]">{req.company_name}</p>
                        </div>
                        <div>
                          <span className="font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B]">Feature</span>
                          <p className="font-kosugi text-[#A0A0A0]">{req.whats_new_items?.title ?? "—"}</p>
                        </div>
                        <div>
                          <span className="font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B]">Requested</span>
                          <p className="font-kosugi text-[#A0A0A0]">{new Date(req.requested_at).toLocaleDateString()}</p>
                        </div>
                      </div>

                      {req.status === "pending" && (
                        <>
                          <div>
                            <label className="block font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B] mb-1">
                              Notes (optional)
                            </label>
                            <textarea
                              value={adminNotes}
                              onChange={(e) => setAdminNotes(e.target.value)}
                              placeholder="Add notes for the email..."
                              rows={2}
                              className="w-full bg-white/[0.05] border border-white/[0.08] rounded px-3 py-2 font-kosugi text-[12px] text-[#E5E5E5] placeholder:text-[#6B6B6B] outline-none focus:border-[#597794]/50 resize-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRequestDecision(req.id, "approved")}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#9DB582]/20 border border-[#9DB582]/30 rounded font-mohave text-[11px] uppercase text-[#9DB582] hover:bg-[#9DB582]/30 transition-colors"
                            >
                              <Check className="w-3 h-3" /> Approve
                            </button>
                            <button
                              onClick={() => handleRequestDecision(req.id, "rejected")}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#93321A]/20 border border-[#93321A]/30 rounded font-mohave text-[11px] uppercase text-[#93321A] hover:bg-[#93321A]/30 transition-colors"
                            >
                              <X className="w-3 h-3" /> Reject
                            </button>
                          </div>
                        </>
                      )}

                      {req.admin_notes && (
                        <div>
                          <span className="font-mohave text-[10px] uppercase tracking-widest text-[#6B6B6B]">Admin Notes</span>
                          <p className="font-kosugi text-[12px] text-[#A0A0A0]">{req.admin_notes}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Category Card ───────────────────────────────────────────────────────────

function CategoryCard({
  category, isExpanded, onToggleExpand,
  editingCat, setEditingCat, onUpdateCategory, onDeleteCategory,
  editingItem, setEditingItem, onUpdateItem, onDeleteItem,
  addingItemToCat, setAddingItemToCat, onCreateItem,
}: {
  category: WhatsNewCategory;
  isExpanded: boolean;
  onToggleExpand: () => void;
  editingCat: string | null;
  setEditingCat: (id: string | null) => void;
  onUpdateCategory: (id: string, updates: Partial<WhatsNewCategory>) => void;
  onDeleteCategory: (id: string) => void;
  editingItem: string | null;
  setEditingItem: (id: string | null) => void;
  onUpdateItem: (id: string, updates: Partial<WhatsNewItem>) => void;
  onDeleteItem: (id: string) => void;
  addingItemToCat: string | null;
  setAddingItemToCat: (id: string | null) => void;
  onCreateItem: (categoryId: string, title: string, description: string, icon: string, status: string, featureFlagSlug: string) => void;
}) {
  const [editName, setEditName] = useState(category.name);
  const [editIcon, setEditIcon] = useState(category.icon);
  const isEditing = editingCat === category.id;

  return (
    <div className={`border rounded-lg overflow-hidden ${category.is_active ? "border-white/[0.08]" : "border-white/[0.04] opacity-60"}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onToggleExpand} className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors flex-shrink-0">
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>

          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                value={editIcon}
                onChange={(e) => setEditIcon(e.target.value)}
                className="w-20 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1 font-mono text-[11px] text-[#E5E5E5] outline-none"
                placeholder="icon"
              />
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1 font-mohave text-[14px] text-[#E5E5E5] outline-none"
              />
              <button onClick={() => { onUpdateCategory(category.id, { name: editName, icon: editIcon }); }} className="text-[#9DB582] hover:text-[#9DB582]/80">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setEditingCat(null)} className="text-[#6B6B6B] hover:text-[#E5E5E5]">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-[#6B6B6B] bg-white/[0.05] px-1.5 py-0.5 rounded">{category.icon}</span>
              <h3 className="font-mohave text-[15px] font-semibold uppercase text-[#E5E5E5]">{category.name}</h3>
              <span className="font-kosugi text-[11px] text-[#6B6B6B]">{category.whats_new_items.length} items</span>
            </div>
          )}
        </div>

        {!isEditing && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => onUpdateCategory(category.id, { is_active: !category.is_active })} className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors" title={category.is_active ? "Hide" : "Show"}>
              {category.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>
            <button onClick={() => { setEditingCat(category.id); setEditName(category.name); setEditIcon(category.icon); }} className="text-[#6B6B6B] hover:text-[#597794] transition-colors">
              <Edit2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => onDeleteCategory(category.id)} className="text-[#6B6B6B] hover:text-[#93321A] transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Items */}
      {isExpanded && (
        <div className="border-t border-white/[0.06]">
          {category.whats_new_items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              isEditing={editingItem === item.id}
              onStartEdit={() => setEditingItem(item.id)}
              onCancelEdit={() => setEditingItem(null)}
              onUpdate={onUpdateItem}
              onDelete={onDeleteItem}
            />
          ))}

          {addingItemToCat === category.id ? (
            <NewItemForm
              onSubmit={(title, desc, icon, status, slug) => onCreateItem(category.id, title, desc, icon, status, slug)}
              onCancel={() => setAddingItemToCat(null)}
            />
          ) : (
            <button
              onClick={() => setAddingItemToCat(category.id)}
              className="flex items-center gap-2 px-6 py-2.5 w-full text-[#6B6B6B] hover:text-[#E5E5E5] hover:bg-white/[0.02] transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span className="font-mohave text-[11px] uppercase tracking-wider">Add Item</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Item Row ────────────────────────────────────────────────────────────────

function ItemRow({
  item, isEditing, onStartEdit, onCancelEdit, onUpdate, onDelete,
}: {
  item: WhatsNewItem;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onUpdate: (id: string, updates: Partial<WhatsNewItem>) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [icon, setIcon] = useState(item.icon);
  const [status, setStatus] = useState(item.status);
  const [slug, setSlug] = useState(item.feature_flag_slug ?? "");

  const statusOption = STATUS_OPTIONS.find((s) => s.value === item.status);

  if (isEditing) {
    return (
      <div className="px-6 py-3 border-b border-white/[0.04] space-y-2 bg-white/[0.02]">
        <div className="grid grid-cols-[80px_1fr] gap-2">
          <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="icon" className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-kosugi text-[12px] text-[#E5E5E5] outline-none" />
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={2} className="w-full bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-kosugi text-[12px] text-[#E5E5E5] outline-none resize-none" />
        <div className="flex gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mohave text-[11px] uppercase text-[#E5E5E5] outline-none">
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="feature_flag_slug (optional)" className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none" />
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancelEdit} className="px-3 py-1.5 font-mohave text-[11px] uppercase text-[#6B6B6B] hover:text-[#E5E5E5]">Cancel</button>
          <button onClick={() => onUpdate(item.id, { title, description, icon, status, feature_flag_slug: slug || null })} className="flex items-center gap-1 px-3 py-1.5 bg-[#9DB582]/20 border border-[#9DB582]/30 rounded font-mohave text-[11px] uppercase text-[#9DB582] hover:bg-[#9DB582]/30">
            <Check className="w-3 h-3" /> Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between px-6 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${!item.is_active ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-mono text-[10px] text-[#6B6B6B] w-16 truncate flex-shrink-0">{item.icon}</span>
        <div className="min-w-0">
          <span className="font-kosugi text-[13px] text-[#E5E5E5]">{item.title}</span>
          {item.feature_flag_slug && (
            <span className="ml-2 font-mono text-[10px] text-[#597794] bg-[#597794]/10 px-1.5 py-0.5 rounded">{item.feature_flag_slug}</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="font-mohave text-[10px] uppercase tracking-widest" style={{ color: statusOption?.color ?? "#6B6B6B" }}>
          {statusOption?.label ?? item.status}
        </span>
        <button onClick={() => onUpdate(item.id, { is_active: !item.is_active })} className="text-[#6B6B6B] hover:text-[#E5E5E5] transition-colors">
          {item.is_active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        </button>
        <button onClick={onStartEdit} className="text-[#6B6B6B] hover:text-[#597794] transition-colors">
          <Edit2 className="w-3 h-3" />
        </button>
        <button onClick={() => onDelete(item.id)} className="text-[#6B6B6B] hover:text-[#93321A] transition-colors">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── New Category Form ───────────────────────────────────────────────────────

function NewCategoryForm({ onSubmit, onCancel }: { onSubmit: (name: string, icon: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("star");

  return (
    <div className="border border-[#597794]/30 rounded-lg px-4 py-3 space-y-2">
      <div className="flex gap-2">
        <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="icon" className="w-24 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mohave text-[14px] text-[#E5E5E5] outline-none" autoFocus />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 font-mohave text-[11px] uppercase text-[#6B6B6B] hover:text-[#E5E5E5]">Cancel</button>
        <button onClick={() => name && onSubmit(name, icon)} disabled={!name} className="px-3 py-1.5 bg-[#597794] rounded font-mohave text-[11px] uppercase text-white hover:bg-[#597794]/80 disabled:opacity-40">Create</button>
      </div>
    </div>
  );
}

// ─── New Item Form ───────────────────────────────────────────────────────────

function NewItemForm({ onSubmit, onCancel }: { onSubmit: (title: string, desc: string, icon: string, status: string, slug: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("star");
  const [status, setStatus] = useState("planned");
  const [slug, setSlug] = useState("");

  return (
    <div className="px-6 py-3 border-t border-[#597794]/20 bg-[#597794]/5 space-y-2">
      <div className="grid grid-cols-[80px_1fr] gap-2">
        <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="icon" className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-kosugi text-[12px] text-[#E5E5E5] outline-none" autoFocus />
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={2} className="w-full bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-kosugi text-[12px] text-[#E5E5E5] outline-none resize-none" />
      <div className="flex gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mohave text-[11px] uppercase text-[#E5E5E5] outline-none">
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="feature_flag_slug (optional)" className="flex-1 bg-white/[0.05] border border-white/[0.08] rounded px-2 py-1.5 font-mono text-[11px] text-[#E5E5E5] outline-none" />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 font-mohave text-[11px] uppercase text-[#6B6B6B] hover:text-[#E5E5E5]">Cancel</button>
        <button onClick={() => title && onSubmit(title, description, icon, status, slug)} disabled={!title} className="px-3 py-1.5 bg-[#597794] rounded font-mohave text-[11px] uppercase text-white hover:bg-[#597794]/80 disabled:opacity-40">Create</button>
      </div>
    </div>
  );
}
