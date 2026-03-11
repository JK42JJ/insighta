-- Create storage bucket for uploaded files
INSERT INTO storage.buckets (id, name, public)
VALUES ('insight-files', 'insight-files', true);

-- Allow authenticated and anonymous users to upload files
CREATE POLICY "Anyone can upload files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'insight-files');

-- Allow anyone to read files
CREATE POLICY "Anyone can read files"
ON storage.objects FOR SELECT
USING (bucket_id = 'insight-files');

-- Allow users to delete their own files
CREATE POLICY "Anyone can delete files"
ON storage.objects FOR DELETE
USING (bucket_id = 'insight-files');