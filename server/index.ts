import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { Pool } from "pg";
import { supabase } from "./supabase.js";

console.log("Supabase URL:", process.env.SUPABASE_URL);

// Потім у коді можна робити запити
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

// Зберігаємо стан кімнат в пам'яті
const rooms: Record<string, any> = {};

io.on("connection", (socket) => {
    console.log("New WS connection:", socket.id);

    socket.on("join", async ({ roomId, player }) => {
        socket.join(roomId);

        // Якщо кімната нова, створюємо
        if (!rooms[roomId]) rooms[roomId] = { players: [], state: {} };
        rooms[roomId].players.push(player);

        // Зберігаємо в Supabase
        await supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });

        // Відправляємо оновлення всім у кімнаті
        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });

    socket.on("action", async ({ roomId, action }) => {
        // Оновлюємо стан кімнати
        rooms[roomId].state = { ...rooms[roomId].state, ...action };

        // Зберігаємо в Supabase
        await supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });

        // Відправляємо оновлення всім гравцям
        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
