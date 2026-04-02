-- ═══════════════════════════════════════════════════════════════════════════════
-- ANCHOR — Daily Prompts System
-- Run this in your Supabase SQL editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Create tables
CREATE TABLE IF NOT EXISTS daily_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  category text DEFAULT 'general',
  sort_order int DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompt_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id uuid NOT NULL,
  prompt_id uuid REFERENCES daily_prompts(id),
  user_id uuid NOT NULL,
  response text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2. RLS policies
ALTER TABLE daily_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read prompts"
  ON daily_prompts FOR SELECT USING (true);

CREATE POLICY "Space members can read responses"
  ON prompt_responses FOR SELECT
  USING (
    space_id IN (
      SELECT id FROM canvases WHERE owner_id = auth.uid() OR partner_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own responses"
  ON prompt_responses FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 3. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_prompt_responses_space_prompt
  ON prompt_responses (space_id, prompt_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. Seed questions (60 curated prompts across 4 categories)
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO daily_prompts (question, category, sort_order) VALUES
-- ── General (warm, light, daily check-ins) ────────────────────────────────
('What made you smile today?', 'general', 1),
('What are you most grateful for right now?', 'general', 2),
('If today had a colour, what would it be?', 'general', 3),
('What''s one thing you''re looking forward to?', 'general', 4),
('Describe your mood in three words.', 'general', 5),
('What song fits your vibe right now?', 'general', 6),
('What''s the best thing that happened this week?', 'general', 7),
('If you could relive one hour today, which one?', 'general', 8),
('What small thing made a big difference lately?', 'general', 9),
('Rate your day 1–10, then explain why.', 'general', 10),
('What would make tomorrow even better?', 'general', 11),
('What did you learn today that surprised you?', 'general', 12),
('What''s on your mind that you haven''t said out loud?', 'general', 13),
('If your pet could talk, what would they say about today?', 'general', 14),
('What comfort food are you craving?', 'general', 15),

-- ── Fun (playful, creative, lighthearted) ─────────────────────────────────
('If we had one free day with no plans, what would we do?', 'fun', 16),
('What funny memory do we share that still makes you laugh?', 'fun', 17),
('If we could swap lives for a day, what would surprise you most?', 'fun', 18),
('What''s a skill you secretly wish you were amazing at?', 'fun', 19),
('Build your perfect pizza right now — what''s on it?', 'fun', 20),
('You can teleport to ONE place for dinner tonight. Where?', 'fun', 21),
('What movie or show are you rewatching (or want to)?', 'fun', 22),
('If you were a character in a sitcom, who would you be?', 'fun', 23),
('What''s the most underrated thing about yourself?', 'fun', 24),
('You have £100 to spend on something pointless. What do you buy?', 'fun', 25),
('What trend do you secretly love that you pretend to hate?', 'fun', 26),
('What''s the weirdest fact you know?', 'fun', 27),
('If you could time-travel for 10 minutes, where do you go?', 'fun', 28),
('What three emojis describe our friendship/relationship?', 'fun', 29),
('What would your autobiography be called?', 'fun', 30),

-- ── Deep (reflective, meaningful, intimate) ───────────────────────────────
('What''s something you''ve never told me but want to?', 'deep', 31),
('When did you last feel truly proud of yourself?', 'deep', 32),
('What''s a fear you''d like to let go of this year?', 'deep', 33),
('How do you want to be remembered?', 'deep', 34),
('What does "home" feel like to you?', 'deep', 35),
('When do you feel most like yourself?', 'deep', 36),
('What opinion have you changed your mind about recently?', 'deep', 37),
('What do you need more of in your life right now?', 'deep', 38),
('What''s a boundary you''re learning to set?', 'deep', 39),
('What does love look like in everyday moments?', 'deep', 40),
('If you could give your younger self one sentence of advice, what would it be?', 'deep', 41),
('What dream have you quietly been holding onto?', 'deep', 42),
('What''s something hard you went through that made you stronger?', 'deep', 43),
('What does your ideal ordinary Tuesday look like in 5 years?', 'deep', 44),
('What are you still figuring out, and that''s okay?', 'deep', 45),

-- ── Memory (nostalgia, shared experiences, looking back) ──────────────────
('What''s a childhood memory that shaped who you are?', 'memory', 46),
('What''s the best trip we''ve ever taken together?', 'memory', 47),
('What''s a meal you''ll never forget?', 'memory', 48),
('What moment do you wish you could photograph but couldn''t?', 'memory', 49),
('Describe a place that always makes you feel calm.', 'memory', 50),
('What''s our best inside joke?', 'memory', 51),
('What tradition do you want to start (or keep)?', 'memory', 52),
('What''s the most thoughtful thing someone has done for you?', 'memory', 53),
('What smell instantly transports you somewhere?', 'memory', 54),
('What season of your life do you look back on most fondly?', 'memory', 55),
('What''s a lesson someone taught you without knowing it?', 'memory', 56),
('What''s the bravest thing you''ve ever done?', 'memory', 57),
('What gift have you received that meant the most?', 'memory', 58),
('What was the last thing that gave you goosebumps?', 'memory', 59),
('If you made a playlist of our story, what''s the first song?', 'memory', 60);

INSERT INTO daily_prompts (question, category, sort_order) VALUES
-- ── More General ────────────────────────────────
('If you could swap jobs with someone for a day, who would it be?', 'general', 61),
('What is a small win you had today?', 'general', 62),
('What is the best compliment you''ve received recently?', 'general', 63),
('If you had to eat one cuisine for the rest of your life, what is it?', 'general', 64),
('What''s a goal you are quietly working towards?', 'general', 65),

-- ── More Fun ────────────────────────────────
('What would be your superpower of choice?', 'fun', 66),
('If our relationship was a TV show, what would the genre be?', 'fun', 67),
('What extinct animal would you bring back if you could?', 'fun', 68),
('What is a hilariously bad movie that you secretly love?', 'fun', 69),
('If you were a pro wrestler, what would your entrance theme be?', 'fun', 70),

-- ── More Deep ────────────────────────────────
('When do you feel most connected to the people around you?', 'deep', 71),
('What is a piece of advice you often give but struggle to follow?', 'deep', 72),
('How has your idea of "success" changed over the years?', 'deep', 73),
('What is a vulnerability you are working on accepting?', 'deep', 74),
('Who has had the biggest impact on the person you are today?', 'deep', 75),

-- ── More Memory ────────────────────────────────
('What was your favorite toy or game growing up?', 'memory', 76),
('What is a memory from our early days that still makes you smile?', 'memory', 77),
('What was the first music album you ever bought?', 'memory', 78),
('Describe your childhood bedroom in 3 words.', 'memory', 79),
('What is a family tradition you cherish?', 'memory', 80);
