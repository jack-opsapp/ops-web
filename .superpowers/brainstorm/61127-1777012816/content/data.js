// Notification data — drawn from AppNotification types in notification-service.ts
// 18 types exist; sample covers the high-frequency ones.

window.NOTIF_TYPES = {
  mention:            { label: "MENTION",      icon: "at-sign",       tone: "attn" },
  role_needed:        { label: "ROLE",         icon: "user-plus",     tone: "critical" },
  pipeline_complete:  { label: "PIPELINE",     icon: "check-circle-2", tone: "info" },
  gmail_sync:         { label: "SYNC",         icon: "refresh-cw",    tone: "ambient" },
  intel_available:    { label: "INTEL",        icon: "radar",         tone: "attn" },
  setup_prompt:       { label: "SETUP",        icon: "settings-2",    tone: "ambient" },
  leads_waiting:      { label: "LEADS",        icon: "inbox",         tone: "attn" },
  system:             { label: "SYS",          icon: "activity",      tone: "ambient" },
  project_assigned:   { label: "PROJECT",      icon: "briefcase",     tone: "info" },
  task_assigned:      { label: "TASK",         icon: "square-check",  tone: "info" },
  task_completed:     { label: "DONE",         icon: "check",         tone: "ambient" },
  schedule_change:    { label: "SCHEDULE",     icon: "calendar-clock", tone: "attn" },
  expense_submitted:  { label: "EXPENSE",      icon: "receipt",       tone: "attn" },
  expense_approved:   { label: "EXP ✓",        icon: "receipt-text",  tone: "ambient" },
  duplicates_found:   { label: "DUPES",        icon: "copy",          tone: "critical" },
  ai_milestone:       { label: "AI",           icon: "sparkle",       tone: "info" },
  agent_suggestion:   { label: "AGENT",        icon: "bot",           tone: "info" },
  trial_expiry:       { label: "TRIAL",        icon: "clock-alert",   tone: "critical" },
};

// tone → color mapping
window.TONE_COLOR = {
  critical: "var(--rose)",      // #B58289 — rose
  attn:     "var(--tan)",       // #C4A868 — tan
  info:     "var(--text-2)",    // neutral
  ambient:  "var(--text-mute)", // decorative
};

// Sample notifications (newest first)
window.SAMPLE_NOTIFS = [
  {
    id: "n1", type: "role_needed", persistent: true,
    title: "Role needed: Site lead",
    body: "PROJ-00247 · 1524 Harbour Ln · starts 08:00 Thu",
    actionLabel: "ASSIGN", actionUrl: "/projects/00247",
    minutesAgo: 2,
  },
  {
    id: "n2", type: "duplicates_found", persistent: true,
    title: "4 possible duplicate clients",
    body: "Matched on phone + last name. Review before sync.",
    actionLabel: "REVIEW", actionUrl: "/clients?dupes=1",
    minutesAgo: 8,
  },
  {
    id: "n3", type: "mention", persistent: false,
    title: "Marcus mentioned you",
    body: "On PROJ-00251 — \"Waiting on your quote before Fri.\"",
    actionLabel: "OPEN", actionUrl: "/projects/00251",
    minutesAgo: 14,
  },
  {
    id: "n4", type: "schedule_change", persistent: false,
    title: "Job rescheduled to 14:30",
    body: "B. Reyes moved PROJ-00244 · rain delay",
    actionLabel: "VIEW", actionUrl: "/calendar",
    minutesAgo: 22,
  },
  {
    id: "n5", type: "expense_submitted", persistent: false,
    title: "$284.50 expense · J. Park",
    body: "Home Depot — roofing materials · PROJ-00239",
    actionLabel: "APPROVE", actionUrl: "/accounting/expenses",
    minutesAgo: 41,
  },
  {
    id: "n6", type: "trial_expiry", persistent: true,
    title: "Trial ends in 3 days",
    body: "Add payment before Apr 26 to avoid lockout.",
    actionLabel: "PAY", actionUrl: "/settings/billing",
    minutesAgo: 64,
  },
  {
    id: "n7", type: "leads_waiting", persistent: false,
    title: "6 new leads unassigned",
    body: "From web form + Google Business · 0 contacted",
    actionLabel: "TRIAGE", actionUrl: "/pipeline?leads=new",
    minutesAgo: 88,
  },
  {
    id: "n8", type: "intel_available", persistent: false,
    title: "Weekly intel brief ready",
    body: "Revenue +12% WoW · 2 at-risk jobs flagged",
    actionLabel: "READ", actionUrl: "/intel",
    minutesAgo: 132,
  },
  {
    id: "n9", type: "mention", persistent: false,
    title: "K. Alvarez mentioned you",
    body: "On invoice INV-00412 — \"Please cc accounting.\"",
    actionLabel: "OPEN", actionUrl: "/invoices/00412",
    minutesAgo: 188,
  },
  {
    id: "n10", type: "task_assigned", persistent: false,
    title: "Task: Confirm crane rental",
    body: "Due Thu 17:00 · assigned by M. Chen",
    actionLabel: "ACK", actionUrl: "/tasks",
    minutesAgo: 245,
  },
  {
    id: "n11", type: "gmail_sync", persistent: false,
    title: "Gmail sync complete",
    body: "84 threads synced · 3 matched to clients",
    actionLabel: null, actionUrl: null,
    minutesAgo: 312,
  },
  {
    id: "n12", type: "pipeline_complete", persistent: false,
    title: "PROJ-00231 closed",
    body: "Final invoice sent · $8,240 · 4 day turnaround",
    actionLabel: "VIEW", actionUrl: "/projects/00231",
    minutesAgo: 380,
  },
  {
    id: "n13", type: "agent_suggestion", persistent: false,
    title: "Agent drafted 3 follow-ups",
    body: "For leads cold >14 days · review before send",
    actionLabel: "REVIEW", actionUrl: "/agent",
    minutesAgo: 510,
  },
  {
    id: "n14", type: "expense_approved", persistent: false,
    title: "Expense approved · $124.90",
    body: "Your receipt from Mon was cleared.",
    actionLabel: null, actionUrl: null,
    minutesAgo: 1440,
  },
];

// helper: relative timestamp
window.fmtRel = (min) => {
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min/60)}h`;
  return `${Math.floor(min/1440)}d`;
};

// helper: absolute timestamp (mock 09:42 style, derived from minutesAgo)
window.fmtAbs = (min) => {
  const now = new Date();
  now.setHours(9, 42, 0, 0); // anchor demo "now" = 09:42
  const then = new Date(now.getTime() - min * 60000);
  const h = String(then.getHours()).padStart(2, "0");
  const m = String(then.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

// Build N-sized dataset for density testing
window.buildNotifs = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const base = window.SAMPLE_NOTIFS[i % window.SAMPLE_NOTIFS.length];
    out.push({
      ...base,
      id: `g${i}`,
      minutesAgo: base.minutesAgo + Math.floor(i / window.SAMPLE_NOTIFS.length) * 600,
    });
  }
  return out;
};
