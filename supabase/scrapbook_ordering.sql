/* ADD ORDERING SUPPORT TO SCRAPBOOK PAGES */
ALTER TABLE scrapbook_entries ADD COLUMN IF NOT EXISTS sequence_index integer DEFAULT 0;

/* INITIALIZE INDEXES FOR EXISTING PAGES */
UPDATE scrapbook_entries
SET sequence_index = subquery.row_number - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY scrapbook_id ORDER BY created_at ASC) as row_number
  FROM scrapbook_entries
) AS subquery
WHERE scrapbook_entries.id = subquery.id;
