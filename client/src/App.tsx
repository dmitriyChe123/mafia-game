import { Routes, Route, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Lobby from './components/Lobby';
import Auth from './components/Auth';
import { Room } from './components/Room';
import { RoomState } from './types';
import { supabase } from './supabase';

export default function App() {
    const [room, setRoom] = useState<RoomState | null>(null);
    const [playerName, setPlayerName] = useState<string>('');
    const [sessionChecked, setSessionChecked] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    const navigate = useNavigate();

    useEffect(() => {
        const initAuth = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            setIsAuthenticated(!!session);
            setSessionChecked(true);
        };

        initAuth();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setIsAuthenticated(!!session);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        const savedName = localStorage.getItem('playerName');
        const savedRoomId = localStorage.getItem('roomId');

        if (savedName) {
            setPlayerName(savedName);
        }

        if (savedRoomId) {
            const savedRoom = localStorage.getItem(`room_${savedRoomId}`);

            if (savedRoom) {
                setRoom(JSON.parse(savedRoom));
            }
        }
    }, []);

    const handleCreateOrJoinRoom = (newRoom: RoomState) => {
        setRoom(newRoom);

        const savedName = localStorage.getItem('playerName') || '';
        setPlayerName(savedName);

        localStorage.setItem('roomId', newRoom.id);
        localStorage.setItem(
            `room_${newRoom.id}`,
            JSON.stringify(newRoom)
        );

        navigate('/room');
    };

    if (!sessionChecked) {
        return (
            <div className="flex h-screen items-center justify-center">
                <p>Загрузка...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Auth />;
    }

    return (
        <Routes>
            <Route
                path="/"
                element={
                    <Lobby
                        onCreateRoom={handleCreateOrJoinRoom}
                    />
                }
            />

            <Route
                path="/room"
                element={
                    room ? (
                        <Room
                            room={room}
                            playerName={playerName}
                        />
                    ) : (
                        <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
                            <p>Немає активної кімнати 😢</p>
                        </div>
                    )
                }
            />
        </Routes>
    );
}