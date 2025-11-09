import { Routes, Route, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Lobby from './components/Lobby';
import { Room } from './components/Room';
import { RoomState } from './types';

export default function App() {
    const [room, setRoom] = useState<RoomState | null>(null);
    const [playerName, setPlayerName] = useState<string>('');
    const navigate = useNavigate();

    // 🟢 Завантаження даних при вході (оновлення вкладки)
    useEffect(() => {
        const savedName = localStorage.getItem('playerName');
        const savedRoomId = localStorage.getItem('roomId');

        if (savedName) setPlayerName(savedName);

        if (savedRoomId) {
            const savedRoom = localStorage.getItem(`room_${savedRoomId}`);
            if (savedRoom) setRoom(JSON.parse(savedRoom));
        }
    }, []);

    // 🟢 Коли створюємо або приєднуємось до кімнати
    const handleCreateOrJoinRoom = (newRoom: RoomState) => {
        setRoom(newRoom);

        const playerName = localStorage.getItem('playerName') || '';
        setPlayerName(playerName);

        localStorage.setItem('roomId', newRoom.id);
        localStorage.setItem(`room_${newRoom.id}`, JSON.stringify(newRoom));

        navigate('/room');
    };

    return (
        <Routes>
            <Route
                path="/"
                element={<Lobby onCreateRoom={handleCreateOrJoinRoom} />}
            />
            <Route
                path="/room"
                element={
                    room ? (
                        <Room room={room} playerName={playerName} />
                    ) : (
                        <div className="flex h-screen justify-center items-center text-white bg-gray-900">
                            <p>Немає активної кімнати 😢</p>
                        </div>
                    )
                }
            />
        </Routes>
    );
}
