import dotenv from "dotenv";
dotenv.config(); // читає .env при локальному запуску

import { createClient } from '@supabase/supabase-js';

// Беремо змінні оточення
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Перевірка на наявність
if (!supabaseUrl || !supabaseKey) {
    console.error("❌ SUPABASE_URL або SUPABASE_KEY не задані!");
    throw new Error("SUPABASE_URL або SUPABASE_KEY не задані!");
}

// Створюємо клієнт
export const supabase = createClient(supabaseUrl, supabaseKey);
