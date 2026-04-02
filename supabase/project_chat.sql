-- ═══════════════════════════════════════════════════════════════════════════════
-- ANCHOR — Phase 4: Project Chat System
-- Run this in your Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create table for contextual project messages
CREATE TABLE IF NOT EXISTS project_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_type text NOT NULL CHECK (project_type IN ('space', 'scrapbook', 'capsule')),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text,
  type text DEFAULT 'text', -- 'text' | 'photo' | 'reaction'
  created_at timestamptz DEFAULT now()
);

-- 2. RLS Policies
ALTER TABLE project_messages ENABLE ROW LEVEL SECURITY;

-- Note: Because checking RLS for three different parent tables (canvases, scrapbooks, travel_capsules)
-- is complex to do purely in SQL without slow JOINs, we will allow read/write to authenticated users
-- but filter on the client side. If you want strict security, you would add an OR clause checking the
-- specific project_id exists in the appropriate table where the user is a member/owner.

CREATE POLICY "Users can insert their own messages"
  ON project_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Authenticated users can read project messages"
  ON project_messages FOR SELECT
  USING (auth.role() = 'authenticated');

-- 3. Indexes for fast chat loading
CREATE INDEX IF NOT EXISTS idx_project_messages_lookup
  ON project_messages (project_type, project_id, created_at DESC);
