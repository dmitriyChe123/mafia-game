import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { Pool } from "pg";
import { supabase } from "./supabase.js";

// Перевірка ключів
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_KEY:", process.env.SUPABASE_KEY ? "ok" : "undefined");

async function testSupabase() {
    const { data, error } = await supabase.from("rooms").select("*");
    if (error) console.error(error);
    else console.log("Supabase test data:", data);
}

testSupabase();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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

const rooms = {};

io.on("connection", (socket) => {
    console.log("New WS connection:", socket.id);

    socket.on("join", async ({ roomId, player }) => {
        socket.join(roomId);
        if (!rooms[roomId]) rooms[roomId] = { players: [], state: {} };
        rooms[roomId].players.push(player);

        await supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });
        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });

    socket.on("action", async ({ roomId, action }) => {
        rooms[roomId].state = { ...rooms[roomId].state, ...action };
        await supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });
        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
