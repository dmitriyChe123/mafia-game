"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const pg_1 = require("pg");
const supabase_js_1 = require("./supabase.js");
console.log("Supabase URL:", process.env.SUPABASE_URL);
// Потім у коді можна робити запити
async function testSupabase() {
    const { data, error } = await supabase_js_1.supabase.from("rooms").select("*");
    if (error)
        console.error(error);
    else
        console.log(data);
}
testSupabase();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
});
app.get("/api/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");
        res.json({ ok: true, time: result.rows[0] });
    }
    catch (e) {
        res.status(500).json({ error: String(e) });
    }
});
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, { cors: { origin: "*" } });
// Зберігаємо стан кімнат в пам'яті
const rooms = {};
io.on("connection", (socket) => {
    console.log("New WS connection:", socket.id);
    socket.on("join", async ({ roomId, player }) => {
        socket.join(roomId);
        // Якщо кімната нова, створюємо
        if (!rooms[roomId])
            rooms[roomId] = { players: [], state: {} };
        rooms[roomId].players.push(player);
        // Зберігаємо в Supabase
        await supabase_js_1.supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });
        // Відправляємо оновлення всім у кімнаті
        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });
    socket.on("action", async ({ roomId, action }) => {
        // Оновлюємо стан кімнати
        rooms[roomId].state = { ...rooms[roomId].state, ...action };
        // Зберігаємо в Supabase
        await supabase_js_1.supabase.from("rooms").upsert({ id: roomId, state: rooms[roomId].state });
        // Відправляємо оновлення всім гравцям
        io.to(roomId).emit("roomUpdate", rooms[roomId]);
    });
});
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));
