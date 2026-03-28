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
