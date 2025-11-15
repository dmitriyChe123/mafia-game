import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

// Ініціалізація Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

console.log("Supabase URL:", supabaseUrl);

// Тест Supabase
async function testSupabase() {
    const { data, error } = await supabase.from("rooms").select("*");
    if (error) console.error("Supabase error:", error);
    else console.log("Supabase rooms:", data);
}

testSupabase();

// Express
const app = express();
app.use(cors());
app.use(express.json());

// Postgres
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

// HTTP + Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// В пам'яті стан кімнат
const rooms = {};

io.on("connection", (socket) => {
    console.log("New WS connection:", socket.id);

    socket.on("join", async ({ roomId, player }) => {
        socket.join(roomId);

        if (!rooms[roomId]) rooms[roomId] = { players: [], state: {} };
        rooms[roomId].players.push(player);

        // Зберігаємо в Supabase
        await supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });

        // Відправляємо всім
        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });

    socket.on("action", async ({ roomId, action }) => {
        rooms[roomId].state = { ...rooms[roomId].state, ...action };

        await supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });

        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });
});

// Старт сервера
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
