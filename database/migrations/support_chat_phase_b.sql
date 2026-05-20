-- Support chat phase B: conversation assignment
ALTER TABLE voicereport.support_conversations
  ADD COLUMN IF NOT EXISTS assigned_to TEXT;
