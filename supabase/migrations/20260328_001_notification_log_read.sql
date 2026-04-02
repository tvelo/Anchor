-- Add read_at column to notification_log for tracking read/unread state
ALTER TABLE notification_log ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- RLS: users can read and update their own notifications
ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own notifications" ON notification_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON notification_log FOR UPDATE USING (auth.uid() = user_id);
