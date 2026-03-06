import { supabase } from "@/shared/integrations/supabase/client";
import type { LinkType } from "@/entities/card/model/types";

// Detect link type from file extension
export const detectFileType = (fileName: string): LinkType => {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith('.txt')) {
    return 'txt';
  }
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return 'md';
  }
  if (lowerName.endsWith('.pdf')) {
    return 'pdf';
  }

  return 'other';
};

// Check if file type is supported
export const isSupportedFileType = (fileName: string): boolean => {
  const fileType = detectFileType(fileName);
  return fileType !== 'other';
};

// Upload file to Supabase storage
export const uploadFile = async (file: File): Promise<{ url: string; fileName: string } | null> => {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `uploads/${fileName}`;

    const { error } = await supabase.storage
      .from('insight-files')
      .upload(filePath, file);

    if (error) {
      console.error('Upload error:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('insight-files')
      .getPublicUrl(filePath);

    return {
      url: urlData.publicUrl,
      fileName: file.name,
    };
  } catch (error) {
    console.error('Upload failed:', error);
    return null;
  }
};

// Get file icon based on type
export const getFileIcon = (linkType: LinkType): string => {
  switch (linkType) {
    case 'txt':
      return '📄';
    case 'md':
      return '📝';
    case 'pdf':
      return '📕';
    default:
      return '📎';
  }
};
