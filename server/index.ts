import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

// --- ENV ---
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PORT = process.env.PORT || 3001;

// --- INIT ---
const app = express();
app.use(cors());
app.use(express.json());

export const supa = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- ROUTES ---
app.get("/health", (req, res) => {
    res.json({ ok: true });
});

// Create room
app.post("/rooms", async (req, res) => {
    const { hostUserId } = req.body;

    const { data, error } = await supa
        .from("rooms")
        .insert([{ host_user_id: hostUserId }])
        .select()
        .single();

    if (error) return res.status(400).json({ error });
    res.json(data);
});

// Join room
app.post("/rooms/join", async (req, res) => {
    const { roomId, userId } = req.body;

    const { data, error } = await supa
        .from("players_in_room")
        .insert([{ room_id: roomId, user_id: userId }])
        .select()
        .single();

    if (error) return res.status(400).json({ error });
    res.json(data);
});

// Get room players
app.get("/rooms/:id/players", async (req, res) => {
    const roomId = req.params.id;

    const { data, error } = await supa
        .from("players_in_room")
        .select("*, users(*)")
        .eq("room_id", roomId);

    if (error) return res.status(400).json({ error });
    res.json(data);
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});