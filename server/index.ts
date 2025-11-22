import express, { Request, Response } from "express";
import cors from "cors";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// --- ENV ---
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY!;
const PORT = process.env.PORT || 3001;

// --- INIT ---
const app = express();
app.use(
    cors({
        origin: "https://mafia-game-beta.vercel.app",
    })
);
app.use(express.json());

export const supa: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- TYPES ---
interface CreateRoomBody {
    hostUserId: string;
}

interface JoinRoomBody {
    roomId: string;
    userId: string;
}

// --- ROUTES ---
app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
});

// Create room
app.post("/rooms", async (req: Request<{}, {}, CreateRoomBody>, res: Response) => {
    try {
        const { hostUserId } = req.body;

        const { data, error } = await supa
            .from("rooms")
            .insert([{ host_user_id: hostUserId }])
            .select()
            .single();

        if (error) throw error;
        res.json({ ok: true, data });
    } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// Join room
app.post("/rooms/join", async (req: Request<{}, {}, JoinRoomBody>, res: Response) => {
    try {
        const { roomId, userId } = req.body;

        const { data, error } = await supa
            .from("players_in_room")
            .insert([{ room_id: roomId, user_id: userId }])
            .select()
            .single();

        if (error) throw error;
        res.json({ ok: true, data });
    } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// Get room players
app.get("/rooms/:id/players", async (req: Request, res: Response) => {
    try {
        const roomId = req.params.id;

        const { data, error } = await supa
            .from("players_in_room")
            .select("*, users(*)")
            .eq("room_id", roomId);

        if (error) throw error;
        res.json({ ok: true, data });
    } catch (err: any) {
        res.status(400).json({ ok: false, error: err.message });
    }
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
