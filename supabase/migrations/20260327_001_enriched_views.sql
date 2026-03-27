-- Enriched views to eliminate N+1 query patterns
-- Run via: supabase db push or apply manually

-- View: canvases with member count and last widget timestamp
CREATE OR REPLACE VIEW canvases_enriched AS
SELECT
  c.*,
  COUNT(DISTINCT sm.user_id) AS member_count,
  MAX(w.created_at) AS last_activity
FROM canvases c
LEFT JOIN space_members sm ON sm.space_id = c.id
LEFT JOIN canvas_widgets w ON w.canvas_id = c.id
GROUP BY c.id;

-- View: travel capsules with media and member counts
CREATE OR REPLACE VIEW travel_capsules_enriched AS
SELECT
  tc.*,
  COUNT(DISTINCT tcm.id) AS media_count,
  COUNT(DISTINCT tm.user_id) AS member_count
FROM travel_capsules tc
LEFT JOIN travel_capsule_media tcm ON tcm.capsule_id = tc.id
LEFT JOIN travel_capsule_members tm ON tm.capsule_id = tc.id
GROUP BY tc.id;

-- RPC: social posts enriched for a given user (cursor-based pagination)
CREATE OR REPLACE FUNCTION get_enriched_posts(
  p_user_id UUID,
  p_limit INT DEFAULT 20,
  p_cursor TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
  id UUID, user_id UUID, type TEXT, reference_id UUID,
  caption TEXT, thumbnail_url TEXT, title TEXT,
  music_url TEXT, music_name TEXT, created_at TIMESTAMPTZ,
  like_count BIGINT, liked_by_me BOOLEAN,
  comment_count BIGINT, favourited_by_me BOOLEAN
) LANGUAGE sql STABLE AS $$
  SELECT
    p.id, p.user_id, p.type, p.reference_id,
    p.caption, p.thumbnail_url, p.title,
    p.music_url, p.music_name, p.created_at,
    COUNT(DISTINCT l.user_id) AS like_count,
    BOOL_OR(l.user_id = p_user_id) AS liked_by_me,
    COUNT(DISTINCT co.id) AS comment_count,
    BOOL_OR(f.user_id = p_user_id) AS favourited_by_me
  FROM social_posts p
  LEFT JOIN social_likes l ON l.post_id = p.id
  LEFT JOIN social_comments co ON co.post_id = p.id
  LEFT JOIN social_favourites f ON f.post_id = p.id AND f.user_id = p_user_id
  WHERE p.created_at < p_cursor
  GROUP BY p.id
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

-- social_reports table (referenced in code but was missing)
CREATE TABLE IF NOT EXISTS social_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES social_posts(id) ON DELETE CASCADE,
  reported_by UUID REFERENCES auth.users(id),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE social_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can report posts" ON social_reports FOR INSERT
  WITH CHECK (reported_by = auth.uid());
