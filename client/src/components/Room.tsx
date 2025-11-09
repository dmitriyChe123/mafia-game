import { useEffect, useState } from 'react';
import { RoomState, Player, Role } from '../types';
import { getCurrentPhase, nextPhase } from '../game/phaseManager';
import { GAME_PHASES } from '../game/phases';
import { assignRolesToPlayers } from '../game/roleAssigner';

interface RoomProps {
    room: RoomState;
    playerName: string;
}

export function Room({ room: initialRoom, playerName }: RoomProps) {
    const [room, setRoom] = useState<RoomState>(initialRoom);
    const [timer, setTimer] = useState<number | null>(null);
    const [isPaused, setIsPaused] = useState(false);
    const localPlayerId = localStorage.getItem('playerId');
    //const isAdmin = localPlayerId === room.adminId;
    const isAdmin = true;

    // 🟢 Таймер
    useEffect(() => {
        const currentPhase = GAME_PHASES.find(p => p.key === room.phase);
        if (currentPhase?.duration && currentPhase.hasTimer) {
            setTimer(currentPhase.duration);
        } else {
            setTimer(null);
        }
    }, [room.phase]);

    useEffect(() => {
        if (!timer || isPaused) return;
        const interval = setInterval(() => {
            setTimer(prev => {
                if (!prev || prev <= 1) {
                    clearInterval(interval);
                    if (isAdmin) handleNextPhase();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [timer, isPaused]);

    // 🟢 Початок гри
    const handleStart = () => {
        if (!isAdmin || room.phase !== 'lobby') return;

        if (room.phase !== 'lobby') return;

        // 🧩 Генеруємо розподіл ролей
        const playersWithRoles = assignRolesToPlayers(room.players);

        const updatedRoom: RoomState = {
            ...room,
            players: playersWithRoles,
            phase: 'night',
            currentPhaseIndex: 0,
        };

        setRoom(updatedRoom);
        localStorage.setItem(`room_${updatedRoom.id}`, JSON.stringify(updatedRoom));

        window.dispatchEvent(
            new StorageEvent('storage', {
                key: `room_${updatedRoom.id}`,
                newValue: JSON.stringify(updatedRoom),
            })
        );
    };

    const handleNextPhase = () => {
        if (!isAdmin) return;
        const updated = nextPhase(room);
        setRoom(updated);
        localStorage.setItem(`room_${updated.id}`, JSON.stringify(updated));
    };

    const handleRepeatPhase = () => {
        const current = GAME_PHASES.find(p => p.key === room.phase);
        if (current?.duration) setTimer(current.duration);
    };

    const handleCopyId = async () => {
        try {
            await navigator.clipboard.writeText(room.id);
            alert('Room ID скопійовано!');
        } catch {
            alert('Помилка копіювання');
        }
    };

    return (
        <div className="flex h-screen bg-gray-900 text-gray-100">
            {/* 🎥 Стіл гравців */}
            <div className="flex-1 flex flex-wrap justify-center items-center gap-6 p-6">
                {room.players.map((p, i) => (
                    <div
                        key={p.id}
                        className={`w-44 h-44 bg-gray-800 rounded-lg shadow border flex flex-col items-center justify-center relative ${
                            p.alive ? 'border-green-700' : 'border-red-700 opacity-60'
                        }`}
                    >
                        <div className="absolute top-1 left-1 text-xs text-gray-400">#{i + 1}</div>
                        <div className="w-32 h-20 bg-gray-700 rounded mb-2 flex items-center justify-center">
                            <span className="text-gray-400 text-sm">Camera</span>
                        </div>
                        <div className="text-sm font-semibold">{p.name}</div>
                        {isAdmin && (
                            <div className="absolute top-1 right-1 text-xs bg-red-800 px-1 rounded">
                                {p.role}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* 🧭 Сайдбар */}
            <div className="w-72 bg-gray-800 border-l border-gray-700 p-4 flex flex-col justify-between">
                <div>
                    <h2 className="font-bold text-red-400 mb-2">
                        Room ID: {room.id}
                        <button
                            onClick={handleCopyId}
                            className="ml-2 text-gray-400 hover:text-white"
                        >
                            📋
                        </button>
                    </h2>

                    <h3 className="text-yellow-300">
                        Поточна фаза: {getCurrentPhase(room)?.name}
                    </h3>

                    {timer !== null && (
                        <div className="mt-2">
                            <span className="text-lg text-green-400">⏱ {timer}s</span>
                        </div>
                    )}

                    <p className="mt-4 text-gray-300">
                        Ви увійшли як: <strong>{playerName}</strong>
                    </p>

                    <h4 className="mt-4 font-semibold text-red-400">Гравці:</h4>
                    <ul className="text-sm text-gray-300">
                        {room.players.map((p, idx) => (
                            <li key={p.id}>
                                #{idx + 1} {p.name} {p.alive ? '🙂' : '💀'}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* 🎮 Кнопки керування */}
                {isAdmin && (
                    <div className="flex flex-col gap-2 mt-4">
                        <button
                            onClick={() => setIsPaused(p => !p)}
                            className="bg-gray-700 hover:bg-gray-600 py-1 rounded"
                        >
                            {isPaused ? '▶ Продовжити' : '⏸ Пауза'}
                        </button>
                        <button
                            onClick={handleRepeatPhase}
                            className="bg-yellow-700 hover:bg-yellow-600 py-1 rounded"
                        >
                            🔁 Повтор фази
                        </button>
                        {room.phase === 'lobby' ? (
                            <button
                                onClick={handleStart}
                                className="bg-green-700 hover:bg-green-600 py-2 rounded font-bold"
                            >
                                🚀 Старт гри
                            </button>
                        ) : (
                            <button
                                onClick={handleNextPhase}
                                className="bg-purple-700 hover:bg-purple-600 py-2 rounded font-bold"
                            >
                                ⏭ Наступна фаза
                            </button>
                        )}
                    </div>
                )}

                {/* 📹 Камера адміна */}
                {isAdmin && (
                    <div className="mt-6 bg-gray-700 rounded-lg p-3 h-32 flex items-center justify-center">
                        <span className="text-gray-400">Admin Camera</span>
                    </div>
                )}
            </div>
        </div>
    );
}
