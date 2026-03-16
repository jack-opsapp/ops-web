-- 036_ai_memory_tables.sql
-- AI memory system tables — feature-gated but schema created upfront
-- Requires pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;

-- Core memory entries (facts, preferences, traits)
CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  memory_type TEXT NOT NULL,  -- 'fact', 'preference', 'trait', 'relationship', 'correction'
  category TEXT NOT NULL,     -- 'writing_style', 'pricing', 'client_preference', 'lead_source', etc.
  content TEXT NOT NULL,
  embedding halfvec(1536),
  confidence FLOAT NOT NULL DEFAULT 1.0,
  source TEXT,       -- 'email', 'invoice', 'project', 'user_upload', 'draft_edit'
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ,
  access_count INT NOT NULL DEFAULT 0,
  decay_score FLOAT NOT NULL DEFAULT 1.0
);

CREATE INDEX idx_am_company ON agent_memories(company_id);
CREATE INDEX idx_am_category ON agent_memories(company_id, category);
CREATE INDEX idx_am_embedding ON agent_memories USING hnsw (embedding halfvec_cosine_ops);

ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company-scoped memories" ON agent_memories
  FOR ALL USING (company_id = (auth.jwt()->>'company_id')::uuid);

-- Knowledge graph edges (entity relationships)
CREATE TABLE agent_knowledge_graph (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,  -- 'person', 'company', 'project', 'invoice'
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,     -- 'works_for', 'manages', 'invoiced', 'prefers', 'tone_with'
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_akg_company ON agent_knowledge_graph(company_id);
CREATE INDEX idx_akg_subject ON agent_knowledge_graph(company_id, subject_type, subject_id);
CREATE INDEX idx_akg_object ON agent_knowledge_graph(company_id, object_type, object_id);

ALTER TABLE agent_knowledge_graph ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company-scoped knowledge graph" ON agent_knowledge_graph
  FOR ALL USING (company_id = (auth.jwt()->>'company_id')::uuid);

-- User writing profiles (per-user, per-company)
CREATE TABLE agent_writing_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  formality_score FLOAT,
  avg_sentence_length FLOAT,
  greeting_patterns JSONB DEFAULT '[]',
  closing_patterns JSONB DEFAULT '[]',
  vocabulary_preferences JSONB DEFAULT '{}',
  tone_traits JSONB DEFAULT '{}',
  emails_analyzed INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_id, user_id)
);

ALTER TABLE agent_writing_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company-scoped writing profiles" ON agent_writing_profiles
  FOR ALL USING (company_id = (auth.jwt()->>'company_id')::uuid);
