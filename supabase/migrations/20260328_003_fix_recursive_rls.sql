-- Drop the recursive policies
drop policy if exists "Members can view capsules" on travel_capsules;
drop policy if exists "Members can view members" on travel_capsule_members;

-- Re-create them without recursion
-- A user can see a capsule if they are the owner, OR if there's a membership record for them
create policy "Members can view capsules" on travel_capsules for select
  using (
    created_by = auth.uid() or 
    exists (
      select 1 from travel_capsule_members 
      where capsule_id = travel_capsules.id and user_id = auth.uid()
    )
  );

-- A user can see member records if the record belongs to them, OR if they are the owner of the capsule, OR if they are both in the same capsule
create policy "Members can view members" on travel_capsule_members for select
  using (
    user_id = auth.uid() or
    exists (
      select 1 from travel_capsules 
      where id = travel_capsule_members.capsule_id and created_by = auth.uid()
    ) or
    exists (
      select 1 from travel_capsule_members peer 
      where peer.capsule_id = travel_capsule_members.capsule_id and peer.user_id = auth.uid()
    )
  );
