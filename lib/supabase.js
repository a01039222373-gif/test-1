import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 환경변수가 없으면 null: 화면은 동작하지만 표시가 다른 사용자와 공유되지 않는다.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
