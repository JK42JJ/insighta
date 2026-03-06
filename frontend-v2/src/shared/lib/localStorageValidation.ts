import { z } from "zod";
import type { MandalaLevel } from "@/entities/card/model/types";

// Schema for MandalaLevel stored in localStorage
export const mandalaLevelSchema = z.object({
  id: z.string(),
  centerGoal: z.string(),
  subjects: z.array(z.string()).length(8),
  parentId: z.string().nullable(),
  parentCellIndex: z.number().nullable(),
  cards: z.array(z.any()).default([]), // Cards are managed separately
});

// Schema for L2 sub-level data
export const subLevelSchema = z.object({
  id: z.string().optional(),
  centerGoal: z.string().optional(),
  subjects: z.array(z.string()).length(8),
  parentId: z.string().nullable().optional(),
  parentCellIndex: z.number().nullable().optional(),
  cards: z.array(z.any()).optional(),
});

/**
 * Safely parse and validate MandalaLevel from localStorage
 * Returns null if parsing or validation fails
 */
export function parseValidatedMandalaLevel(key: string): MandalaLevel | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const validated = mandalaLevelSchema.safeParse(parsed);

    if (!validated.success) {
      console.warn(`Invalid data in localStorage key "${key}":`, validated.error.issues);
      return null;
    }

    return validated.data as MandalaLevel;
  } catch (error) {
    console.warn(`Failed to parse localStorage key "${key}":`, error);
    return null;
  }
}

/**
 * Safely parse and validate sub-level subjects from localStorage
 * Returns null if parsing or validation fails
 */
export function parseValidatedSubLevel(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const validated = subLevelSchema.safeParse(parsed);

    if (!validated.success) {
      console.warn(`Invalid sub-level data in localStorage key "${key}":`, validated.error.issues);
      return null;
    }

    return validated.data.subjects;
  } catch (error) {
    console.warn(`Failed to parse sub-level localStorage key "${key}":`, error);
    return null;
  }
}

/**
 * Safely parse any JSON from localStorage with error handling
 * Returns null if parsing fails
 */
export function safeParseJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`Failed to parse localStorage key "${key}":`, error);
    return null;
  }
}
