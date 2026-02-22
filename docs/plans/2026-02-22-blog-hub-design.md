# Blog Hub Design

**Date:** 2026-02-22
**Status:** Approved

## Overview

Full blog writing, publishing, and analytics hub integrated into the OPS admin dashboard. Migrates existing blog data from Bubble to Supabase, adds a custom WYSIWYG editor, GA4 analytics per post, public-facing SEO-optimized blog pages, and API endpoints for n8n automation.

## Requirements

- **Migration**: Move blog posts from Bubble to Supabase, flatten section-based content into single HTML body
- **Admin UI**: New "BLOG" tab (9th sidebar item) at `/admin/blog` with dashboard, post CRUD, and topic management
- **Custom editor**: Built-in WYSIWYG using contentEditable — no external editor library
- **GA4 analytics**: Real page views per post, content performance insights, views-over-time charts
- **Two view counts**: Editable `display_views` (shown on public page) + real GA4 views (shown in admin)
- **Date + time**: Auto-set on publish, fully editable. Display format: "POSTED AT MONDAY 5:35 AM"
- **FAQ/Q&A sections**: Per-post structured FAQ pairs, rendered as visible Q&A + FAQPage JSON-LD schema
- **API endpoints**: REST endpoints for n8n workflow to programmatically create/update posts
- **Public blog**: `/blog` index + `/blog/[slug]` detail pages, SSR, full structured data for AI SEO
- **Blog Topics**: Content idea bank with used/unused tracking
- **Images**: Keep existing Bubble CDN URLs, new uploads go to Supabase Storage

## Database Schema

### `blog_categories`

| Column     | Type       | Notes                        |
|------------|------------|------------------------------|
| id         | uuid PK    | gen_random_uuid()            |
| name       | text       | NOT NULL                     |
| slug       | text       | UNIQUE, URL-safe             |
| created_at | timestamptz| DEFAULT now()                |

Pre-seeded: Leadership, Educational, Technology, Current Events, Insightful, Case Study, How-To

### `blog_topics`

| Column     | Type       | Notes                        |
|------------|------------|------------------------------|
| id         | uuid PK    | gen_random_uuid()            |
| topic      | text       | NOT NULL                     |
| author     | text       | DEFAULT 'The Ops Team'       |
| image_url  | text       | Optional                     |
| used       | boolean    | DEFAULT false                |
| created_at | timestamptz| DEFAULT now()                |
| updated_at | timestamptz| DEFAULT now()                |

### `blog_posts`

| Column        | Type       | Notes                                      |
|---------------|------------|---------------------------------------------|
| id            | uuid PK    | gen_random_uuid()                           |
| title         | text       | NOT NULL                                    |
| subtitle      | text       |                                             |
| slug          | text       | UNIQUE NOT NULL, auto-generated from title  |
| author        | text       |                                             |
| content       | text       | NOT NULL, HTML from custom editor           |
| summary       | text       | Used as meta description                    |
| teaser        | text       | Hook text for cards                         |
| meta_title    | text       | SEO <title> override                        |
| thumbnail_url | text       | Hero image URL                              |
| category_id   | uuid FK    | -> blog_categories                          |
| category2_id  | uuid FK    | -> blog_categories (optional)               |
| is_live       | boolean    | DEFAULT false (draft)                       |
| display_views | integer    | DEFAULT 0, editable, shown on public page   |
| word_count    | integer    | Auto-calculated from content                |
| faqs          | jsonb      | [{question, answer}] for FAQ section + JSON-LD |
| published_at  | timestamptz| Editable, auto-set on first publish         |
| created_at    | timestamptz| DEFAULT now()                               |
| updated_at    | timestamptz| DEFAULT now()                               |

No RLS needed — blog posts are public reads, admin-only writes via service role.

## Admin UI Design

### Sidebar

New 9th nav item: `{ href: "/admin/blog", label: "BLOG" }`

### Blog Hub Layout — 3 tabs within the page

#### Tab 1: Dashboard (default)

**KPI cards (6-column grid):**
- Total Posts (Supabase count)
- Live Posts (is_live = true)
- Draft Posts (is_live = false)
- Total GA4 Views 30d (GA4 page_view on /blog/*)
- Avg Views Per Post (GA4 total / live count)
- Topic Ideas Remaining (blog_topics where used = false)

**Charts:**
- Views over time — line chart, GA4 views on /blog/* by day, 30d
- Top performing posts — bar chart, top 10 by GA4 views

**Content insights:**
- Posts ranked by GA4 views with category tags
- Columns: title, category, GA4 views, display views, published date, word count
- Color-coded performance (above/below average)

#### Tab 2: Posts (list + CRUD)

**Post list table columns:**
- Title (clickable -> editor)
- Category (badge)
- Status (Live/Draft badge)
- Display Views
- GA4 Views
- Published (date + time)
- Word Count

Filters: category dropdown, status (live/draft/all). Sort by any column.
"New Post" button -> `/admin/blog/new`

**Post editor** (`/admin/blog/[id]/edit` or `/admin/blog/new`):

Left (70%) — Content area:
- Title input (large, borderless)
- Subtitle input
- Custom WYSIWYG toolbar: H2, H3, Bold, Italic, Link, Image, Bullet list, Numbered list, Blockquote
- contentEditable div, outputs/stores HTML
- FAQ section: add/remove/reorder Q&A pairs (question + answer fields)

Right (30%) — Metadata sidebar:
- Thumbnail upload/preview
- Author
- Category 1 dropdown
- Category 2 dropdown (optional)
- Meta Title (with character count)
- Summary textarea (meta description)
- Teaser textarea
- Slug (auto-generated, editable)
- Published Date + Time picker (editable)
- Display Views (number input)
- Word count (read-only, auto)
- Publish toggle: Draft <-> Live

#### Tab 3: Topics (idea bank)

Table: Topic, Author, Used (checkbox), Created date
New Topic button, edit/delete inline.

## API Endpoints (n8n integration)

| Endpoint                | Method | Purpose              |
|-------------------------|--------|----------------------|
| `/api/blog/posts`       | GET    | List posts (paginated) |
| `/api/blog/posts`       | POST   | Create post          |
| `/api/blog/posts/[id]`  | PUT    | Update post          |
| `/api/blog/posts/[id]`  | DELETE | Delete post          |

- Auth: API key in Authorization header
- POST/PUT accept JSON matching blog_posts schema
- `content` accepts raw HTML
- `faqs` accepts [{question, answer}]
- Auto-generates slug from title if not provided
- Auto-calculates word_count from content

## Public Blog Pages

| Route          | Purpose                                    |
|----------------|--------------------------------------------|
| `/blog`        | Index — grid of post cards                 |
| `/blog/[slug]` | Detail — full article with structured data |

### `/blog/[slug]` renders:
- `<article>` wrapper, proper heading hierarchy (H1 title, H2/H3 from content)
- FAQ section as visible Q&A blocks
- `display_views` as the shown view count
- Timestamp: "POSTED AT MONDAY 5:35 AM"
- JSON-LD: Article schema + FAQPage schema
- Open Graph + Twitter meta tags
- Fully SSR

## GA4 Blog Queries

New functions in ga4-client.ts following existing patterns:

```
getBlogPageViews(days)     — total page_view where pagePath starts with /blog/
getBlogViewsByPost(days)   — page_view by pagePath (per slug)
getBlogViewsTimeline(days) — page_view on /blog/* by date
```

Server-side only, called from admin blog dashboard.

## SEO / AI Search Optimization

- Semantic HTML: `<article>`, `<section>`, proper heading hierarchy
- JSON-LD Article schema: title, author, datePublished, dateModified, image, description
- JSON-LD FAQPage schema: from faqs field
- Open Graph + Twitter Card meta tags
- Meta description from summary field
- Proper H1 > H2 > H3 hierarchy in rendered content
- FAQ section for AI Overview / AIO citation eligibility
- SSR for full crawlability

## Image Strategy

- Existing posts: keep Bubble CDN URLs as-is
- New uploads: Supabase Storage
- No immediate bulk migration needed

## Dropped Fields (from Bubble)

- Instruction, instructionContext, instructionIndex — unused
- Related Course — unused
- BlogData — unused
- sectionCount — derived, unnecessary
- Sections (as separate entity) — flattened into content HTML
