-- RLS policies for core tables
-- Users can read/write their own row in the users table

-- USERS table
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own row" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own row" ON users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own row" ON users FOR UPDATE USING (auth.uid() = id);

-- SOCIAL_PROFILES table
ALTER TABLE social_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read profiles" ON social_profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile" ON social_profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON social_profiles FOR UPDATE USING (auth.uid() = id);

-- SOCIAL_POSTS table
ALTER TABLE social_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read posts" ON social_posts FOR SELECT USING (true);
CREATE POLICY "Users can insert own posts" ON social_posts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own posts" ON social_posts FOR DELETE USING (auth.uid() = user_id);

-- SOCIAL_LIKES table
ALTER TABLE social_likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read likes" ON social_likes FOR SELECT USING (true);
CREATE POLICY "Users can insert own likes" ON social_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own likes" ON social_likes FOR DELETE USING (auth.uid() = user_id);

-- SOCIAL_COMMENTS table
ALTER TABLE social_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read comments" ON social_comments FOR SELECT USING (true);
CREATE POLICY "Users can insert own comments" ON social_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own comments" ON social_comments FOR DELETE USING (auth.uid() = user_id);

-- SOCIAL_FAVOURITES table
ALTER TABLE social_favourites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own favourites" ON social_favourites FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own favourites" ON social_favourites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own favourites" ON social_favourites FOR DELETE USING (auth.uid() = user_id);

-- SOCIAL_FOLLOWS table
ALTER TABLE social_follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read follows" ON social_follows FOR SELECT USING (true);
CREATE POLICY "Users can insert own follows" ON social_follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "Users can delete own follows" ON social_follows FOR DELETE USING (auth.uid() = follower_id);

-- CANVASES table
ALTER TABLE canvases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own canvases" ON canvases FOR SELECT USING (auth.uid() = owner_id OR auth.uid() = partner_id);
CREATE POLICY "Users can insert own canvases" ON canvases FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update own canvases" ON canvases FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete own canvases" ON canvases FOR DELETE USING (auth.uid() = owner_id);

-- CANVAS_WIDGETS table
ALTER TABLE canvas_widgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read widgets in their canvases" ON canvas_widgets FOR SELECT USING (
  EXISTS (SELECT 1 FROM canvases c WHERE c.id = canvas_id AND (c.owner_id = auth.uid() OR c.partner_id = auth.uid()))
);
CREATE POLICY "Users can insert widgets in their canvases" ON canvas_widgets FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM canvases c WHERE c.id = canvas_id AND (c.owner_id = auth.uid() OR c.partner_id = auth.uid()))
);
CREATE POLICY "Users can update widgets in their canvases" ON canvas_widgets FOR UPDATE USING (
  EXISTS (SELECT 1 FROM canvases c WHERE c.id = canvas_id AND (c.owner_id = auth.uid() OR c.partner_id = auth.uid()))
);
CREATE POLICY "Users can delete widgets in their canvases" ON canvas_widgets FOR DELETE USING (
  EXISTS (SELECT 1 FROM canvases c WHERE c.id = canvas_id AND (c.owner_id = auth.uid() OR c.partner_id = auth.uid()))
);

-- SPACE_MEMBERS table
ALTER TABLE space_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read space members" ON space_members FOR SELECT USING (true);
CREATE POLICY "Users can insert own membership" ON space_members FOR INSERT WITH CHECK (auth.uid() = user_id);
