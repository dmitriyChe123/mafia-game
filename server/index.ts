import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

// Гарантовано беремо строки з env
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

// TypeScript типізація для кімнат
interface Room {
    players: string[];
    state: Record<string, any>;
}

const rooms: Record<string, Room> = {};

console.log("Supabase URL:", supabaseUrl);

async function testSupabase() {
    const { data, error } = await supabase.from("rooms").select("*");
    if (error) console.error(error);
    else console.log(data);
}

testSupabase();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

app.get("/api/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");
        res.json({ ok: true, time: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", (socket) => {
    console.log("New WS connection:", socket.id);

    socket.on("join", async ({ roomId, player }: { roomId: string; player: string }) => {
        socket.join(roomId);

        if (!rooms[roomId]) rooms[roomId] = { players: [], state: {} };
        rooms[roomId].players.push(player);

        await supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });

        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });

    socket.on("action", async ({ roomId, action }: { roomId: string; action: Record<string, any> }) => {
        rooms[roomId].state = { ...rooms[roomId].state, ...action };

        await supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });

        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
