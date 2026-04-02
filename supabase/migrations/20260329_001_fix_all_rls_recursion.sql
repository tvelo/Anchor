-- ═══════════════════════════════════════════════════════════════════════════════
-- FIX: Infinite recursion in RLS policies
--
-- Root cause: canvases SELECT ↔ space_members SELECT reference each other,
--             scrapbook_entries → scrapbooks → canvases chains also trigger it,
--             scrapbook_members INSERT policies self-reference.
--
-- Solution:   1. Create SECURITY DEFINER helper functions (bypass RLS)
--             2. Drop ALL existing policies on the 5 affected tables
--             3. Recreate minimal, non-recursive policies
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 1. SECURITY DEFINER helper functions ──────────────────────────────────────

-- Check if a user is a member of a space (bypasses space_members RLS)
CREATE OR REPLACE FUNCTION is_space_member_of(p_space_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM space_members
    WHERE space_id = p_space_id AND user_id = p_user_id
  );
$$;

-- Check if a user is owner or partner of a canvas (bypasses canvases RLS)
CREATE OR REPLACE FUNCTION is_canvas_owner_or_partner(p_canvas_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM canvases
    WHERE id = p_canvas_id AND (owner_id = p_user_id OR partner_id = p_user_id)
  );
$$;

-- Replace is_scrapbook_member as SECURITY DEFINER (bypasses scrapbook_members RLS)
CREATE OR REPLACE FUNCTION is_scrapbook_member(sid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scrapbook_members
    WHERE scrapbook_id = sid AND user_id = uid
  );
$$;

-- Replace is_scrapbook_owner as SECURITY DEFINER (bypasses scrapbooks RLS)
CREATE OR REPLACE FUNCTION is_scrapbook_owner(sid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scrapbooks
    WHERE id = sid AND created_by = uid
  );
$$;

-- Check if user can edit a scrapbook (bypasses scrapbook_members RLS)
CREATE OR REPLACE FUNCTION is_scrapbook_editor(p_scrapbook_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scrapbook_members
    WHERE scrapbook_id = p_scrapbook_id
      AND user_id = p_user_id
      AND can_edit = true
  );
$$;

-- Check if user can view a scrapbook entry's scrapbook
-- (owner of scrapbook, member of scrapbook, or owner/partner of parent canvas)
CREATE OR REPLACE FUNCTION can_access_scrapbook(p_scrapbook_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM scrapbooks s
    WHERE s.id = p_scrapbook_id
      AND (
        s.created_by = p_user_id
        OR EXISTS (SELECT 1 FROM scrapbook_members WHERE scrapbook_id = s.id AND user_id = p_user_id)
        OR EXISTS (SELECT 1 FROM canvases WHERE id = s.canvas_id AND (owner_id = p_user_id OR partner_id = p_user_id))
        OR (s.canvas_id IS NOT NULL AND EXISTS (SELECT 1 FROM space_members WHERE space_id = s.canvas_id AND user_id = p_user_id))
      )
  );
$$;

-- Recreate add_space_member as SECURITY DEFINER
CREATE OR REPLACE FUNCTION add_space_member(p_space_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM canvases WHERE id = p_space_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the space owner can invite members';
  END IF;
  INSERT INTO space_members (space_id, user_id, role)
  VALUES (p_space_id, p_user_id, 'member')
  ON CONFLICT DO NOTHING;
END;
$$;

-- Recreate create_scrapbook as SECURITY DEFINER
CREATE OR REPLACE FUNCTION create_scrapbook(
  p_name text,
  p_canvas_id uuid,
  p_theme_color text DEFAULT '#C9956C'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO scrapbooks (name, canvas_id, created_by, theme_color)
  VALUES (p_name, p_canvas_id, auth.uid(), p_theme_color)
  RETURNING id INTO new_id;

  INSERT INTO scrapbook_members (scrapbook_id, user_id, can_edit, invited_by)
  VALUES (new_id, auth.uid(), true, auth.uid());

  RETURN new_id;
END;
$$;


-- ─── 2. DROP ALL existing policies ─────────────────────────────────────────────

-- canvases
DROP POLICY IF EXISTS "Private spaces isolation" ON canvases;
DROP POLICY IF EXISTS "canvas_delete" ON canvases;
DROP POLICY IF EXISTS "canvas_insert" ON canvases;
DROP POLICY IF EXISTS "canvas_select" ON canvases;
DROP POLICY IF EXISTS "canvas_update" ON canvases;
DROP POLICY IF EXISTS "canvases_select_policy" ON canvases;
DROP POLICY IF EXISTS "Users can read own canvases" ON canvases;
DROP POLICY IF EXISTS "Users can insert own canvases" ON canvases;
DROP POLICY IF EXISTS "Users can update own canvases" ON canvases;
DROP POLICY IF EXISTS "Users can delete own canvases" ON canvases;

-- space_members
DROP POLICY IF EXISTS "Anyone can join space_members" ON space_members;
DROP POLICY IF EXISTS "Anyone can read space members" ON space_members;
DROP POLICY IF EXISTS "Members can insert" ON space_members;
DROP POLICY IF EXISTS "Members can invite to space" ON space_members;
DROP POLICY IF EXISTS "Members can view their spaces" ON space_members;
DROP POLICY IF EXISTS "Owners can delete members" ON space_members;
DROP POLICY IF EXISTS "SpaceMembers: member read" ON space_members;
DROP POLICY IF EXISTS "SpaceMembers: owner delete" ON space_members;
DROP POLICY IF EXISTS "SpaceMembers: self insert" ON space_members;
DROP POLICY IF EXISTS "Users can insert own membership" ON space_members;
DROP POLICY IF EXISTS "space_members_insert" ON space_members;
DROP POLICY IF EXISTS "space_members_select" ON space_members;

-- scrapbooks
DROP POLICY IF EXISTS "sb_delete" ON scrapbooks;
DROP POLICY IF EXISTS "sb_insert" ON scrapbooks;
DROP POLICY IF EXISTS "sb_select" ON scrapbooks;
DROP POLICY IF EXISTS "sb_update" ON scrapbooks;
DROP POLICY IF EXISTS "scrapbooks_select" ON scrapbooks;

-- scrapbook_entries
DROP POLICY IF EXISTS "Entries: editor delete" ON scrapbook_entries;
DROP POLICY IF EXISTS "Entries: editor update" ON scrapbook_entries;
DROP POLICY IF EXISTS "Entries: member insert" ON scrapbook_entries;
DROP POLICY IF EXISTS "Entries: member read" ON scrapbook_entries;
DROP POLICY IF EXISTS "Space members can insert entries" ON scrapbook_entries;
DROP POLICY IF EXISTS "Space members can update entries" ON scrapbook_entries;
DROP POLICY IF EXISTS "Space members can view entries" ON scrapbook_entries;
DROP POLICY IF EXISTS "Users can delete own entries" ON scrapbook_entries;
DROP POLICY IF EXISTS "scrapbook_entries_delete" ON scrapbook_entries;
DROP POLICY IF EXISTS "scrapbook_entries_insert" ON scrapbook_entries;
DROP POLICY IF EXISTS "scrapbook_entries_select" ON scrapbook_entries;
DROP POLICY IF EXISTS "scrapbook_entries_update" ON scrapbook_entries;

-- scrapbook_members
DROP POLICY IF EXISTS "Editors can invite to scrapbook" ON scrapbook_members;
DROP POLICY IF EXISTS "Members can invite others to scrapbook" ON scrapbook_members;
DROP POLICY IF EXISTS "sbm_delete" ON scrapbook_members;
DROP POLICY IF EXISTS "sbm_insert" ON scrapbook_members;
DROP POLICY IF EXISTS "sbm_select" ON scrapbook_members;
DROP POLICY IF EXISTS "scrapbook_members_insert" ON scrapbook_members;
DROP POLICY IF EXISTS "scrapbook_members_select" ON scrapbook_members;


-- ─── 3. RECREATE clean policies ────────────────────────────────────────────────

-- ── CANVASES ────────────────────────────────────────────────────────────────────
-- SELECT: owner, partner, or space member (via SECURITY DEFINER fn → no recursion)
CREATE POLICY "canvases_select" ON canvases FOR SELECT USING (
  owner_id = auth.uid()
  OR partner_id = auth.uid()
  OR is_space_member_of(id, auth.uid())
);

-- INSERT: only the owner
CREATE POLICY "canvases_insert" ON canvases FOR INSERT WITH CHECK (
  owner_id = auth.uid()
);

-- UPDATE: owner or partner
CREATE POLICY "canvases_update" ON canvases FOR UPDATE USING (
  owner_id = auth.uid() OR partner_id = auth.uid()
);

-- DELETE: only the owner
CREATE POLICY "canvases_delete" ON canvases FOR DELETE USING (
  owner_id = auth.uid()
);


-- ── SPACE_MEMBERS ───────────────────────────────────────────────────────────────
-- SELECT: anyone can read (no cross-table check → no recursion)
CREATE POLICY "space_members_select" ON space_members FOR SELECT USING (true);

-- INSERT: user can add themselves (owner invites go through add_space_member RPC)
CREATE POLICY "space_members_insert" ON space_members FOR INSERT WITH CHECK (
  user_id = auth.uid()
);

-- DELETE: user can remove themselves, or canvas owner can remove anyone
CREATE POLICY "space_members_delete" ON space_members FOR DELETE USING (
  user_id = auth.uid()
  OR is_canvas_owner_or_partner(space_id, auth.uid())
);


-- ── SCRAPBOOKS ──────────────────────────────────────────────────────────────────
-- SELECT: creator, scrapbook member, or canvas owner/partner/space-member
--         (all via SECURITY DEFINER fns → no recursion)
CREATE POLICY "scrapbooks_select" ON scrapbooks FOR SELECT USING (
  created_by = auth.uid()
  OR is_scrapbook_member(id, auth.uid())
  OR is_canvas_owner_or_partner(canvas_id, auth.uid())
  OR (canvas_id IS NOT NULL AND is_space_member_of(canvas_id, auth.uid()))
);

-- INSERT: only the creator (scrapbook + member row created atomically via create_scrapbook RPC)
CREATE POLICY "scrapbooks_insert" ON scrapbooks FOR INSERT WITH CHECK (
  created_by = auth.uid()
);

-- UPDATE: creator or scrapbook member
CREATE POLICY "scrapbooks_update" ON scrapbooks FOR UPDATE USING (
  created_by = auth.uid()
  OR is_scrapbook_member(id, auth.uid())
);

-- DELETE: only the creator
CREATE POLICY "scrapbooks_delete" ON scrapbooks FOR DELETE USING (
  created_by = auth.uid()
);


-- ── SCRAPBOOK_ENTRIES ───────────────────────────────────────────────────────────
-- SELECT: anyone who can access the parent scrapbook (via SECURITY DEFINER fn)
CREATE POLICY "scrapbook_entries_select" ON scrapbook_entries FOR SELECT USING (
  can_access_scrapbook(scrapbook_id, auth.uid())
);

-- INSERT: scrapbook editors or the entry author
CREATE POLICY "scrapbook_entries_insert" ON scrapbook_entries FOR INSERT WITH CHECK (
  is_scrapbook_editor(scrapbook_id, auth.uid())
);

-- UPDATE: scrapbook editors
CREATE POLICY "scrapbook_entries_update" ON scrapbook_entries FOR UPDATE USING (
  is_scrapbook_editor(scrapbook_id, auth.uid())
);

-- DELETE: entry author or scrapbook owner
CREATE POLICY "scrapbook_entries_delete" ON scrapbook_entries FOR DELETE USING (
  added_by = auth.uid()
  OR is_scrapbook_owner(scrapbook_id, auth.uid())
);


-- ── SCRAPBOOK_MEMBERS ───────────────────────────────────────────────────────────
-- SELECT: anyone can read (avoids self-referencing recursion)
CREATE POLICY "scrapbook_members_select" ON scrapbook_members FOR SELECT USING (true);

-- INSERT: user adding themselves, or scrapbook owner inviting
--         (via SECURITY DEFINER fn → no recursion)
CREATE POLICY "scrapbook_members_insert" ON scrapbook_members FOR INSERT WITH CHECK (
  user_id = auth.uid()
  OR is_scrapbook_owner(scrapbook_id, auth.uid())
);

-- DELETE: user removing themselves, or scrapbook owner removing anyone
CREATE POLICY "scrapbook_members_delete" ON scrapbook_members FOR DELETE USING (
  user_id = auth.uid()
  OR is_scrapbook_owner(scrapbook_id, auth.uid())
);
