-- Create storage bucket for image uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('images', 'images', true, 10485760)
ON CONFLICT (id) DO NOTHING;

-- Allow public reads (bucket is public)
CREATE POLICY "Public read images" ON storage.objects
  FOR SELECT USING (bucket_id = 'images');

-- Allow service role to upload (service role bypasses RLS, but explicit for clarity)
CREATE POLICY "Service upload images" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'images');

CREATE POLICY "Service delete images" ON storage.objects
  FOR DELETE USING (bucket_id = 'images');
