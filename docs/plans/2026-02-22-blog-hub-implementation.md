# Blog Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a full blog writing, publishing, and analytics hub — Supabase schema, admin dashboard tab, custom WYSIWYG editor, GA4 analytics, API endpoints for n8n, and public SEO-optimized blog pages.

**Architecture:** New Supabase tables (blog_categories, blog_topics, blog_posts) with no RLS (public reads, service-role writes). Admin UI follows existing pattern: server components fetch via admin-queries, pass data to client components. Public blog at `/blog` and `/blog/[slug]` uses SSR with JSON-LD structured data. Custom WYSIWYG built with contentEditable. API routes at `/api/blog/` authenticated via API key for n8n.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Supabase (PostgreSQL), Tailwind CSS, Recharts, GA4 Data API, contentEditable WYSIWYG

**Design doc:** `docs/plans/2026-02-22-blog-hub-design.md`

---

## Task 1: Database Schema Migration

**Files:**
- Create: `supabase/migrations/EXECUTED/009_blog_schema.sql`

**Step 1: Write the migration SQL**

```sql
-- 009_blog_schema.sql
-- Blog categories, topics, and posts tables

-- Blog Categories
CREATE TABLE IF NOT EXISTS blog_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO blog_categories (name, slug) VALUES
  ('Leadership',     'leadership'),
  ('Educational',    'educational'),
  ('Technology',     'technology'),
  ('Current Events', 'current-events'),
  ('Insightful',     'insightful'),
  ('Case Study',     'case-study'),
  ('How-To',         'how-to');

-- Blog Topics
CREATE TABLE IF NOT EXISTS blog_topics (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic      text NOT NULL,
  author     text NOT NULL DEFAULT 'The Ops Team',
  image_url  text,
  used       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Blog Posts
CREATE TABLE IF NOT EXISTS blog_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  subtitle      text,
  slug          text UNIQUE NOT NULL,
  author        text,
  content       text NOT NULL DEFAULT '',
  summary       text,
  teaser        text,
  meta_title    text,
  thumbnail_url text,
  category_id   uuid REFERENCES blog_categories(id),
  category2_id  uuid REFERENCES blog_categories(id),
  is_live       boolean NOT NULL DEFAULT false,
  display_views integer NOT NULL DEFAULT 0,
  word_count    integer NOT NULL DEFAULT 0,
  faqs          jsonb DEFAULT '[]'::jsonb,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_blog_posts_live ON blog_posts (is_live, published_at DESC)
  WHERE is_live = true;
CREATE INDEX idx_blog_posts_slug ON blog_posts (slug);
```

**Step 2: Apply migration via Supabase MCP `apply_migration` tool**

**Step 3: Verify tables exist via `execute_sql`:**
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'blog%';
```

**Step 4: Verify seed data:**
```sql
SELECT name, slug FROM blog_categories ORDER BY name;
```

**Step 5: Commit**
```bash
git add supabase/migrations/EXECUTED/009_blog_schema.sql
git commit -m "feat: add blog schema — categories, topics, posts tables"
```

---

## Task 2: Blog Types + Query Functions

**Files:**
- Modify: `src/lib/admin/types.ts` (append blog types)
- Create: `src/lib/admin/blog-queries.ts`

**Step 1: Append blog types to `src/lib/admin/types.ts`**

Add after the last interface:

```typescript
// Blog Types

export interface BlogCategory {
  id: string;
  name: string;
  slug: string;
}

export interface BlogTopic {
  id: string;
  topic: string;
  author: string;
  image_url: string | null;
  used: boolean;
  created_at: string;
  updated_at: string;
}

export interface BlogPost {
  id: string;
  title: string;
  subtitle: string | null;
  slug: string;
  author: string | null;
  content: string;
  summary: string | null;
  teaser: string | null;
  meta_title: string | null;
  thumbnail_url: string | null;
  category_id: string | null;
  category2_id: string | null;
  is_live: boolean;
  display_views: number;
  word_count: number;
  faqs: { question: string; answer: string }[];
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogPostListItem extends BlogPost {
  category_name: string | null;
  category2_name: string | null;
  ga4_views?: number;
}
```

**Step 2: Create `src/lib/admin/blog-queries.ts`**

Full query functions for categories, topics, and posts CRUD. Follows same pattern as `admin-queries.ts` — uses `getAdminSupabase()` service role client. Includes:
- `getBlogCategories()`
- `getBlogTopics()`, `getUnusedTopicCount()`, `createBlogTopic()`, `updateBlogTopic()`, `deleteBlogTopic()`
- `getBlogPostCount()`, `getBlogPosts()`, `getBlogPostBySlug()`, `getBlogPostById()`, `getLiveBlogPosts()`
- `createBlogPost()`, `updateBlogPost()`, `deleteBlogPost()`
- Helper: `slugify()` for auto-slug, `countWords()` for word count from HTML

See design doc for full schema. Key behaviors:
- `createBlogPost`: auto-generates slug from title, auto-calculates word_count, auto-sets published_at when is_live=true
- `updateBlogPost`: recalculates word_count on content change, auto-sets published_at on first publish

**Step 3: Verify build:** `npx tsc --noEmit`

**Step 4: Commit**
```bash
git add src/lib/admin/types.ts src/lib/admin/blog-queries.ts
git commit -m "feat: add blog types and Supabase query functions"
```

---

## Task 3: GA4 Blog Analytics Queries

**Files:**
- Modify: `src/lib/analytics/ga4-client.ts` (append functions)

**Step 1: Add 3 new GA4 query functions at end of file**

- `getBlogPageViews(days)` — total `screenPageViews` where `pagePath` begins with `/blog/`
- `getBlogViewsByPost(days, limit)` — `screenPageViews` by `pagePath` dimension, filtered to `/blog/*`, sorted desc
- `getBlogViewsTimeline(days)` — `screenPageViews` by `date` dimension, filtered to `/blog/*`, sorted asc

All follow the exact same pattern as existing functions like `getEventByPlatform()` and `getEventByDate()`.

**Step 2: Verify build + Commit**
```bash
npx tsc --noEmit
git add src/lib/analytics/ga4-client.ts
git commit -m "feat: add GA4 blog analytics queries"
```

---

## Task 4: Admin Sidebar — Add BLOG Tab

**Files:**
- Modify: `src/app/admin/_components/sidebar.tsx`

**Step 1: Add `{ href: "/admin/blog", label: "BLOG" }` to NAV_ITEMS array, between FEEDBACK and SYSTEM**

**Step 2: Verify visually:** `npm run dev`, navigate to `/admin`

**Step 3: Commit**
```bash
git add src/app/admin/_components/sidebar.tsx
git commit -m "feat: add BLOG tab to admin sidebar"
```

---

## Task 5: Blog Dashboard Page (Tab 1 — KPIs + Charts)

**Files:**
- Create: `src/app/admin/blog/page.tsx` (server component)
- Create: `src/app/admin/blog/_components/blog-hub-content.tsx` (client, SubTabs wrapper)
- Create: `src/app/admin/blog/_components/blog-dashboard.tsx` (KPIs + insights table)
- Create: `src/app/admin/blog/_components/blog-charts.tsx` (Recharts line + bar)

**`page.tsx`**: Server component that fetches all data via `Promise.all`:
- `getBlogPostCount()`, `getBlogPosts()`, `getBlogCategories()`, `getUnusedTopicCount()`
- `getBlogPageViews(30)`, `getBlogViewsByPost(30)`, `getBlogViewsTimeline(30)`
- Maps GA4 views onto posts by matching slug
- Passes everything to `<BlogHubContent />`

**`blog-hub-content.tsx`**: Client component using existing `<SubTabs>` with tabs: Dashboard, Posts, Topics. Renders the active tab's component.

**`blog-dashboard.tsx`**: 6 StatCards (Total Posts, Live, Drafts, GA4 Views 30d, Avg Views/Post, Topic Ideas). Content insights table below showing live posts ranked by GA4 views with color-coded performance (green above avg, red below).

**`blog-charts.tsx`**: Two charts side by side — AdminLineChart for views timeline, AdminBarChart for top posts by views. Formats GA4 date dimensions ("20260215" -> "Feb 15") and slug paths.

**Step 5: Verify build + visual check**

**Step 6: Commit**
```bash
git add src/app/admin/blog/
git commit -m "feat: add blog dashboard with KPIs, GA4 charts, content insights"
```

---

## Task 6: Blog Posts Tab (List + Navigation)

**Files:**
- Create: `src/app/admin/blog/_components/blog-posts-tab.tsx`

Client component with:
- Status filter (all/live/draft), category filter dropdown
- Sortable table: Title (links to editor), Category badge, Status badge, Display Views, GA4 Views, Published date, Word Count
- "New Post" Link button to `/admin/blog/new`
- Click title links to `/admin/blog/[id]/edit`

**Commit**
```bash
git add src/app/admin/blog/_components/blog-posts-tab.tsx
git commit -m "feat: add blog posts list tab with filters and sorting"
```

---

## Task 7: Blog Topics Tab

**Files:**
- Create: `src/app/admin/blog/_components/blog-topics-tab.tsx`

Client component that:
- Fetches topics from `/api/blog/topics` on mount
- Inline "New Topic" form (topic input + author input + Add button)
- Table: Topic, Author, Used (toggle button), Created, Delete button
- All operations via fetch to API routes

**Commit**
```bash
git add src/app/admin/blog/_components/blog-topics-tab.tsx
git commit -m "feat: add blog topics management tab"
```

---

## Task 8: Custom WYSIWYG Editor Component

**Files:**
- Create: `src/app/admin/blog/_components/rich-text-editor.tsx`

Custom WYSIWYG using `contentEditable` div + `document.execCommand`:
- Toolbar buttons: H2, H3, Bold, Italic, Link, Image URL, Upload, UL, OL, Blockquote
- `onMouseDown` with `preventDefault` on toolbar buttons to preserve text selection
- Tailwind child selectors for styled rendering: `[&_h2]`, `[&_h3]`, `[&_blockquote]`, etc.
- Outputs raw HTML via `onChange` callback
- Image support: URL prompt + file upload (TODO: Supabase Storage upload)

**Commit**
```bash
git add src/app/admin/blog/_components/rich-text-editor.tsx
git commit -m "feat: add custom WYSIWYG rich text editor with contentEditable"
```

---

## Task 9: FAQ Editor Component

**Files:**
- Create: `src/app/admin/blog/_components/faq-editor.tsx`

Structured Q&A pair editor:
- Add/remove/reorder FAQ items
- Each item: question input + answer textarea
- Move up/down buttons for reordering
- Outputs `{question, answer}[]` via onChange

**Commit**
```bash
git add src/app/admin/blog/_components/faq-editor.tsx
git commit -m "feat: add FAQ editor component for blog Q&A sections"
```

---

## Task 10: Blog Post Editor Page

**Files:**
- Create: `src/app/admin/blog/_components/blog-post-editor.tsx` (shared editor component)
- Create: `src/app/admin/blog/new/page.tsx` (server wrapper for new post)
- Create: `src/app/admin/blog/[id]/edit/page.tsx` (server wrapper for edit)

**`blog-post-editor.tsx`**: Full post editor client component:
- Left (70%): Title input, subtitle input, RichTextEditor, FaqEditor
- Right (30%): Metadata sidebar — thumbnail URL + preview, author, category 1/2 dropdowns, meta title (char count), summary, teaser, slug (auto-generated, editable), published date+time picker (`datetime-local`), display views (number input), word count (read-only)
- Save button → POST/PUT to `/api/blog/posts`
- Delete button (edit only) → DELETE
- Draft/Live toggle

**`new/page.tsx`**: Server component that fetches categories, renders `<BlogPostEditor isNew />`

**`[id]/edit/page.tsx`**: Server component that fetches post + categories, renders `<BlogPostEditor initialData={...} />`

**Commit**
```bash
git add src/app/admin/blog/new/ src/app/admin/blog/[id]/ src/app/admin/blog/_components/blog-post-editor.tsx
git commit -m "feat: add blog post editor with WYSIWYG, FAQ editor, metadata sidebar"
```

---

## Task 11: API Routes for Blog Posts + Topics

**Files:**
- Create: `src/app/api/blog/posts/route.ts` (GET list, POST create)
- Create: `src/app/api/blog/posts/[id]/route.ts` (GET, PUT, DELETE)
- Create: `src/app/api/blog/topics/route.ts` (GET list, POST create)
- Create: `src/app/api/blog/topics/[id]/route.ts` (PUT, DELETE)

Auth: Dual auth — Firebase admin check (for dashboard) OR `BLOG_API_KEY` bearer token (for n8n).
Topics routes: Firebase admin auth only.

All routes follow the exact same pattern as `src/app/api/admin/feature-requests/status/route.ts`.

**Commit**
```bash
git add src/app/api/blog/
git commit -m "feat: add blog API routes for posts and topics (admin + n8n auth)"
```

---

## Task 12: Public Blog Pages with SEO

**Files:**
- Create: `src/app/blog/layout.tsx`
- Create: `src/app/blog/page.tsx` (index)
- Create: `src/app/blog/[slug]/page.tsx` (detail)

**`layout.tsx`**: Minimal layout with base metadata.

**`page.tsx`** (index): Fetches live posts + categories. Renders responsive grid of post cards (thumbnail, category badge, title, teaser, date, view count). ISR with `revalidate = 300`.

**`[slug]/page.tsx`** (detail):
- `generateMetadata()`: dynamic OG + Twitter meta from post fields
- `generateStaticParams()`: pre-renders all live post slugs
- Renders: `<article>` with semantic HTML, H1 title, subtitle, author, timestamp formatted as "POSTED AT MONDAY 5:35 AM", display_views count, hero image, content HTML with Tailwind child selectors, FAQ section
- JSON-LD: Article schema + FAQPage schema injected via `<script type="application/ld+json">`
- ISR with `revalidate = 300`

**Commit**
```bash
git add src/app/blog/
git commit -m "feat: add public blog pages with SSR, JSON-LD Article + FAQ schema, OG tags"
```

---

## Task 13: Add BLOG_API_KEY to Environment

**Files:**
- Modify: `.env.example`

Add `BLOG_API_KEY=` with comment. Generate actual key with `openssl rand -hex 32` and add to `.env.local`.

**Commit**
```bash
git add .env.example
git commit -m "chore: add BLOG_API_KEY to env example for n8n integration"
```

---

## Task 14: Final Integration Verification

**Step 1:** `npm run build` — clean build, no errors

**Step 2: Smoke test checklist:**
- `/admin/blog` loads with Dashboard tab (KPIs + charts)
- Posts tab shows list with "New Post" button
- New Post editor: WYSIWYG works (bold, italic, headings, lists, blockquote)
- FAQ editor: add/remove/reorder Q&A pairs
- Save post, toggle live/draft
- Topics tab: add/toggle/delete topics
- `/blog` shows live posts in grid
- `/blog/[slug]` renders article with FAQ section
- View page source: JSON-LD Article + FAQPage schemas present
- API test: `curl -H "Authorization: Bearer $BLOG_API_KEY" localhost:3000/api/blog/posts`

**Step 3: Final commit if any fixes needed**
