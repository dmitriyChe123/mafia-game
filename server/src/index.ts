import express from 'express';
import http from 'http';
import { Server as IOServer } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: '*' }});

// простий роут
app.get('/health', (req, res) => res.json({ ok: true }));

io.on('connection', socket => {
    console.log('socket connected', socket.id);

    socket.on('join-room', (roomId, player) => {
        socket.join(roomId);
        socket.to(roomId).emit('player-joined', player);
    });

    socket.on('room-update', (roomId, payload) => {
        // серверна логіка: валідація + зберегти в БД + поширити
        socket.to(roomId).emit('room-updated', payload);
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening ${PORT}`));
