import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export interface ReviewAnalysisRow {
  id?: number;
  created_at?: string;
  analyzed_on?: string;
  review_no: number;
  written_on: string;
  rating: number;
  review_text: string;
  sentiment: string;
  categories: string;
  improvement_request: string;
  is_safety_issue: boolean;
  model_used: string;
}
