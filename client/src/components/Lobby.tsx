import { useState, useEffect } from 'react';
import { RoomState } from '../types';
import { useNavigate } from 'react-router-dom';
const API = "https://YOUR_SERVER_URL";

interface LobbyProps {
    onCreateRoom: (room: RoomState) => void;
}

export default function Lobby({ onCreateRoom }: LobbyProps) {
    const [name, setName] = useState('');
    const [roomId, setRoomId] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const savedName = localStorage.getItem('playerName');
        if (savedName) setName(savedName);
    }, []);

    // 🟢 створення або приєднання
    const handleAction = () => {
        if (!name.trim()) return alert('Введіть ім’я!');
        const playerId = crypto.randomUUID();

        if (roomId.trim()) {
            // приєднання
            const key = `room_${roomId}`;
            const existing = localStorage.getItem(key);
            if (!existing) return alert('Кімнату не знайдено!');
            const room: RoomState = JSON.parse(existing);

            if (!room.players.some(p => p.name === name)) {
                room.players.push({ id: playerId, name, alive: true });
                localStorage.setItem(key, JSON.stringify(room));
            }

            localStorage.setItem('playerId', playerId);
            localStorage.setItem('playerName', name);
            localStorage.setItem('roomId', roomId);

            onCreateRoom(room);
            navigate('/room');
        } else {
            // створення
            const newRoom: RoomState = {
                id: crypto.randomUUID(),
                players: [{ id: playerId, name, alive: true }],
                phase: 'lobby',
                currentPhaseIndex: 0,
                adminId: playerId,
            };

            localStorage.setItem('playerName', name);
            localStorage.setItem('playerId', playerId);
            localStorage.setItem('roomId', newRoom.id);
            localStorage.setItem(`room_${newRoom.id}`, JSON.stringify(newRoom));

            onCreateRoom(newRoom);
            navigate('/room');
        }
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
            <h1 className="text-4xl mb-2">🎭 Mafia Lobby</h1>
            <input
                type="text"
                placeholder="Your Name"
                className="border rounded p-2 text-black"
                value={name}
                onChange={(e) => setName(e.target.value)}
            />
            <input
                type="text"
                placeholder="Room ID (leave empty to create)"
                className="border rounded p-2 text-black"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
            />
            <button
                onClick={handleAction}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
                {roomId.trim() ? 'Join Room' : 'Create Room'}
            </button>
        </div>
    );
}
