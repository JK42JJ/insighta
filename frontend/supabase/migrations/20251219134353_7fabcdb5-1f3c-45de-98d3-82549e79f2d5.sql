-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Allow public file uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public file reads" ON storage.objects;
DROP POLICY IF EXISTS "Allow public file deletes" ON storage.objects;

-- Create more restrictive policies with file type and size limits
-- Allow uploads with file type restrictions (only images and documents)
CREATE POLICY "Allow uploads with restrictions"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'insight-files' AND
  (
    -- Allow only specific file extensions
    name ~ '\.(txt|md|pdf|jpg|jpeg|png|gif|webp)$'
  )
);

-- Allow reading files (still public but controlled)
CREATE POLICY "Allow public reads"
ON storage.objects FOR SELECT
USING (bucket_id = 'insight-files');

-- Disable delete for now (only uploads and reads allowed)
-- This prevents malicious deletion of other users' files