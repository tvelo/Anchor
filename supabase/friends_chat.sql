-- ═══════════════════════════════════════════════════════════════════════════════
-- ANCHOR — Phase 4: Friends Chat System
-- Run this in your Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create table for conversations (DMs / Groups)
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, -- NULL for 1-on-1 DMs, set for groups
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Create table for conversation members
CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- 3. Create table for direct messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  type text DEFAULT 'text', -- 'text', 'photo', 'widget_share', 'scrapbook_share', 'trip_share'
  metadata jsonb DEFAULT '{}'::jsonb, -- store embed data here
  created_at timestamptz DEFAULT now()
);

-- 4. Enable RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies

-- Conversations: Only members can read/update
CREATE POLICY "Members can view conversations"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Anyone can create conversations"
  ON conversations FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Conversation Members
CREATE POLICY "Users can view members of their conversations"
  ON conversation_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members my_mem 
      WHERE my_mem.conversation_id = conversation_id AND my_mem.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can add members"
  ON conversation_members FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Messages
CREATE POLICY "Members can view messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Members can insert messages"
  ON messages FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM conversation_members 
      WHERE conversation_id = messages.conversation_id AND user_id = auth.uid()
    )
  );

-- Function to update conversation's updated_at securely
CREATE OR REPLACE FUNCTION update_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations SET updated_at = now() WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_conversation_timestamp ON messages;
CREATE TRIGGER trigger_update_conversation_timestamp
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_timestamp();

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_conv_members ON conversation_members (user_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at DESC);
