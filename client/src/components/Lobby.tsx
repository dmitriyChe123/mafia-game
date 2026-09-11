import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { RoomState } from '../types';
import { supabase } from '../supabase';

const API =
    process.env.REACT_APP_API_URL ||
    'http://localhost:3001';

interface LobbyProps {
    onCreateRoom: (room: RoomState) => void;
}

interface BackendRoom {
    id: string;
    name: string;
    admin_id: string;
    created_by: string | null;
    room_type: string;
    room_size: string;
    status: string;
}

export default function Lobby({
                                  onCreateRoom,
                              }: LobbyProps) {
    const navigate = useNavigate();

    const [name, setName] = useState('');
    const [roomId, setRoomId] = useState('');
    const [loading, setLoading] = useState(false);

    const [roomSize, setRoomSize] =
        useState<'small' | 'large'>(
            'small'
        );

    // ==================================================
    // LOAD USER NAME
    // ==================================================

    useEffect(() => {
        const loadUserName = async () => {
            const {
                data: { user },
            } = await supabase.auth.getUser();

            if (!user) {
                return;
            }

            const metadataName =
                user.user_metadata?.name ||
                user.user_metadata?.full_name;

            if (metadataName) {
                setName(metadataName);

                localStorage.setItem(
                    'playerName',
                    metadataName
                );

                return;
            }

            const savedName =
                localStorage.getItem(
                    'playerName'
                );

            if (savedName?.trim()) {
                setName(savedName);
                return;
            }

            const emailName =
                user.email?.split('@')[0] || '';

            setName(emailName);

            localStorage.setItem(
                'playerName',
                emailName
            );
        };

        loadUserName();
    }, []);

    // ==================================================
    // LOGOUT
    // ==================================================

    const handleLogout = async () => {
        await supabase.auth.signOut();

        localStorage.removeItem(
            'roomId'
        );

        navigate('/');
    };

    // ==================================================
    // SESSION
    // ==================================================

    const getSession = async () => {
        const {
            data: { session },
        } =
            await supabase.auth.getSession();

        if (!session?.access_token) {
            throw new Error(
                'Сесія користувача не знайдена'
            );
        }

        return session;
    };

    // ==================================================
    // CREATE ROOM
    // ==================================================

    const createRoom = async () => {
        const session = await getSession();

        const playerDisplayName =
            name.trim() || 'Player';

        const response =
            await fetch(
                `${API}/rooms`,
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json',

                        Authorization:
                            `Bearer ${session.access_token}`,
                    },

                    body: JSON.stringify({
                        /*
                         * Room name.
                         *
                         * For now we keep the
                         * existing default.
                         */

                        name: 'Mafia Room',

                        roomSize,

                        /*
                         * Actual player name.
                         *
                         * Backend will save this
                         * into players_in_room.display_name.
                         */

                        playerName:
                        playerDisplayName,
                    }),
                }
            );

        const result =
            await response.json();

        if (
            !response.ok ||
            !result.ok
        ) {
            throw new Error(
                typeof result.error ===
                'string'
                    ? result.error
                    : 'Не вдалося створити кімнату'
            );
        }

        const backendRoom =
            result.data as BackendRoom;

        const room: RoomState = {
            id: backendRoom.id,

            players: [],

            phase: 'lobby',

            currentPhaseIndex: 0,

            adminId:
                backendRoom.admin_id ||
                session.user.id,
        };

        localStorage.setItem(
            'playerName',
            playerDisplayName
        );

        localStorage.setItem(
            'roomId',
            room.id
        );

        onCreateRoom(room);
    };

    // ==================================================
    // JOIN ROOM
    // ==================================================

    const joinRoom = async () => {
        const session = await getSession();

        const normalizedRoomId =
            roomId.trim();

        const playerDisplayName =
            name.trim() || 'Player';

        if (!normalizedRoomId) {
            throw new Error(
                'Введіть ID кімнати'
            );
        }

        // ----------------------------------------------
        // GET ROOM
        // ----------------------------------------------

        const roomResponse =
            await fetch(
                `${API}/rooms/${normalizedRoomId}`,
                {
                    method: 'GET',

                    headers: {
                        Authorization:
                            `Bearer ${session.access_token}`,
                    },
                }
            );

        const roomResult =
            await roomResponse.json();

        if (
            !roomResponse.ok ||
            !roomResult.ok
        ) {
            throw new Error(
                typeof roomResult.error ===
                'string'
                    ? roomResult.error
                    : 'Кімнату не знайдено'
            );
        }

        const backendRoom =
            roomResult.data as BackendRoom;

        // ----------------------------------------------
        // JOIN / RECONNECT
        // ----------------------------------------------

        const joinResponse =
            await fetch(
                `${API}/rooms/join`,
                {
                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json',

                        Authorization:
                            `Bearer ${session.access_token}`,
                    },

                    body: JSON.stringify({
                        roomId:
                        normalizedRoomId,

                        /*
                         * Current lobby name.
                         *
                         * Backend saves it as
                         * players_in_room.display_name.
                         */

                        playerName:
                        playerDisplayName,
                    }),
                }
            );

        const joinResult =
            await joinResponse.json();

        if (
            !joinResponse.ok ||
            !joinResult.ok
        ) {
            throw new Error(
                typeof joinResult.error ===
                'string'
                    ? joinResult.error
                    : 'Не вдалося приєднатися до кімнати'
            );
        }

        /*
         * waiting => lobby
         *
         * playing => night for now.
         *
         * Later, when we move the actual game
         * phase to backend, this will come from
         * the server instead of being hardcoded.
         */

        const room: RoomState = {
            id: backendRoom.id,

            players: [],

            phase:
                backendRoom.status ===
                'waiting'
                    ? 'lobby'
                    : 'night',

            currentPhaseIndex: 0,

            adminId:
            backendRoom.admin_id,
        };

        localStorage.setItem(
            'playerName',
            playerDisplayName
        );

        localStorage.setItem(
            'roomId',
            room.id
        );

        onCreateRoom(room);
    };

    // ==================================================
    // MATCHMAKING (знайти гру)
    // ==================================================

    const findMatch = async () => {
        const session = await getSession();

        const playerDisplayName =
            name.trim() || 'Player';

        const response = await fetch(
            `${API}/matchmaking/join`,
            {
                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json',

                    Authorization: `Bearer ${session.access_token}`,
                },

                body: JSON.stringify({
                    roomSize,
                }),
            }
        );

        const result =
            await response.json();

        if (
            !response.ok ||
            !result.ok
        ) {
            throw new Error(
                typeof result.error ===
                'string'
                    ? result.error
                    : 'Не вдалося знайти гру'
            );
        }

        const matchedRoomId =
            result.data.roomId as string;

        // Далі — той самий шлях, що й ручний
        // join за кодом кімнати: реєструємось
        // у players_in_room (matchmaking вже це
        // зробив), тож просто дізнаємось поточний
        // стан room і переходимо всередину.

        const roomResponse = await fetch(
            `${API}/rooms/${matchedRoomId}`,
            {
                headers: {
                    Authorization: `Bearer ${session.access_token}`,
                },
            }
        );

        const roomResult =
            await roomResponse.json();

        const backendRoom =
            roomResult.data as BackendRoom;

        const room: RoomState = {
            id: matchedRoomId,

            players: [],

            phase: 'lobby',

            currentPhaseIndex: 0,

            adminId:
            backendRoom?.admin_id,
        };

        localStorage.setItem(
            'playerName',
            playerDisplayName
        );

        localStorage.setItem(
            'roomId',
            room.id
        );

        onCreateRoom(room);
    };

    // ==================================================
    // ACTION
    // ==================================================

    const handleAction = async () => {
        if (!name.trim()) {
            alert('Введіть ім’я!');
            return;
        }

        setLoading(true);

        try {
            if (roomId.trim()) {
                await joinRoom();
            } else {
                await createRoom();
            }
        } catch (error) {
            console.error(
                'LOBBY ERROR:',
                error
            );

            alert(
                error instanceof Error
                    ? error.message
                    : 'Сталася помилка'
            );
        } finally {
            setLoading(false);
        }
    };

    const handleFindMatch =
        async () => {
            if (!name.trim()) {
                alert('Введіть ім’я!');
                return;
            }

            setLoading(true);

            try {
                await findMatch();
            } catch (error) {
                console.error(
                    'MATCHMAKING ERROR:',
                    error
                );

                alert(
                    error instanceof Error
                        ? error.message
                        : 'Сталася помилка'
                );
            } finally {
                setLoading(false);
            }
        };

    // ==================================================
    // RENDER
    // ==================================================

    return (
        <div className="relative flex h-screen flex-col items-center justify-center gap-4 bg-gray-900 text-white">

            {/* LOGOUT */}

            <button
                onClick={handleLogout}
                disabled={loading}
                className="absolute right-5 top-5 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 transition hover:border-red-700 hover:bg-red-900/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
                🚪 Вийти
            </button>

            {/* TITLE */}

            <h1 className="mb-2 text-4xl">
                🎭 Mafia Lobby
            </h1>

            {/* PLAYER NAME */}

            <input
                type="text"
                placeholder="Your Name"
                className="w-80 rounded border p-3 text-black"
                value={name}
                onChange={(e) =>
                    setName(e.target.value)
                }
                disabled={loading}
            />

            {/* ROOM SIZE */}

            <div className="flex w-80 gap-2">
                <button
                    type="button"
                    onClick={() =>
                        setRoomSize('small')
                    }
                    disabled={loading}
                    className={`flex-1 rounded border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        roomSize === 'small'
                            ? 'border-blue-500 bg-blue-600 text-white'
                            : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'
                    }`}
                >
                    Small (8)
                </button>

                <button
                    type="button"
                    onClick={() =>
                        setRoomSize('large')
                    }
                    disabled={loading}
                    className={`flex-1 rounded border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        roomSize === 'large'
                            ? 'border-blue-500 bg-blue-600 text-white'
                            : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500'
                    }`}
                >
                    Large (11)
                </button>
            </div>

            {/* ROOM ID */}

            <input
                type="text"
                placeholder="Room ID (leave empty to create)"
                className="w-80 rounded border p-3 text-black"
                value={roomId}
                onChange={(e) =>
                    setRoomId(e.target.value)
                }
                disabled={loading}
            />

            {/* ACTION */}

            <button
                onClick={handleAction}
                disabled={loading}
                className="w-80 rounded bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
                {loading
                    ? 'Завантаження...'
                    : roomId.trim()
                        ? 'Join Room'
                        : 'Create Room'}
            </button>

            {/* FIND MATCH */}

            {!roomId.trim() ? (
                <button
                    onClick={handleFindMatch}
                    disabled={loading}
                    className="w-80 rounded border border-purple-600 bg-purple-900/30 px-4 py-3 font-semibold text-purple-200 transition hover:bg-purple-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    🔎 Знайти гру ({roomSize === 'small' ? 'Small' : 'Large'})
                </button>
            ) : null}
        </div>
    );
}