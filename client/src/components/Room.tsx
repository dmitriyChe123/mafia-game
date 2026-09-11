import { RoomTable } from './room/RoomTable';
import { RoomSidebar } from './room/RoomSidebar';
import { RoomConnectionBanner } from './room/RoomConnectionBanner';

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { io, Socket } from 'socket.io-client';

import {
    Room as LiveKitRoom,
    RoomEvent,
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    Track,
} from 'livekit-client';

import { RoomState, Player } from '../types';


import { GAME_PHASES } from '../game/phases';


import { supabase } from '../supabase';

interface RoomProps {
    room: RoomState;
    playerName: string;
}

interface BackendPlayer {
    id: string;
    room_id: string;
    user_id: string;
    role: Player['role'] | null;
    status: string;
    joined_at: string;

    connection_status?:
        | 'connected'
        | 'disconnected';

    last_seen_at?: string | null;

    display_name?: string | null;

    users: {
        id: string;
        name: string;
        avatar_url: string | null;
    } | null;
}

interface PlayersResponse {
    ok: boolean;

    room?: {
        id: string;
        admin_id: string;
        status: string;
    };

    data?: BackendPlayer[];

    error?: string;
}

const API =
    process.env.REACT_APP_API_URL ||
    'http://localhost:3001';

const LIVEKIT_URL =
    process.env.REACT_APP_LIVEKIT_URL || '';

export function Room({
                         room: initialRoom,
                         playerName,
                     }: RoomProps) {
    const [room, setRoom] =
        useState<RoomState>(initialRoom);

    const [timer, setTimer] =
        useState<number | null>(null);

    const [isPaused, setIsPaused] =
        useState(false);

    const [loadingPlayers, setLoadingPlayers] =
        useState(true);

    const [currentUserId, setCurrentUserId] =
        useState<string | null>(null);

    const [localStream, setLocalStream] =
        useState<MediaStream | null>(null);

    const [mediaError, setMediaError] =
        useState<string | null>(null);

    const [voteTally, setVoteTally] =
        useState<Record<string, number>>(
            {}
        );

    const [
        nightActionResult,
        setNightActionResult,
    ] = useState<{
        type: string;
        targetUserId: string;
        result: boolean;
    } | null>(null);

    const [winner, setWinner] =
        useState<
            'mafia' | 'civilians' | null
        >(null);

    const [
        transferringAdminId,
        setTransferringAdminId,
    ] = useState<string | null>(null);

    const [remoteStreams, setRemoteStreams] =
        useState<Record<string, MediaStream>>({});

    const [
        disconnectedPlayerIds,
        setDisconnectedPlayerIds,
    ] = useState<string[]>([]);

    const [connectionPaused, setConnectionPaused] =
        useState(false);

    const localStreamRef =
        useRef<MediaStream | null>(null);

    const socketRef =
        useRef<Socket | null>(null);

    const livekitRoomRef =
        useRef<LiveKitRoom | null>(null);

    // ==================================================
    // CURRENT USER
    // ==================================================

    useEffect(() => {
        let mounted = true;

        const loadUser = async () => {
            const {
                data: { user },
            } =
                await supabase.auth.getUser();

            if (mounted && user) {
                setCurrentUserId(user.id);
            }
        };

        loadUser();

        return () => {
            mounted = false;
        };
    }, []);

    // ==================================================
    // ADMIN
    // ==================================================

    const isAdmin = useMemo(() => {
        return (
            !!currentUserId &&
            currentUserId === room.adminId
        );
    }, [
        currentUserId,
        room.adminId,
    ]);

    // ==================================================
    // LOAD PLAYERS
    // ==================================================

    const loadPlayers = useCallback(
        async () => {
            if (!room.id) return;

            try {
                const {
                    data: { session },
                } =
                    await supabase.auth.getSession();

                if (!session?.access_token) {
                    return;
                }

                const response =
                    await fetch(
                        `${API}/rooms/${room.id}/players`,
                        {
                            headers: {
                                Authorization:
                                    `Bearer ${session.access_token}`,
                            },
                        }
                    );

                const result =
                    (await response.json()) as PlayersResponse;

                if (
                    !response.ok ||
                    !result.ok
                ) {
                    console.error(
                        'LOAD PLAYERS ERROR:',
                        result.error
                    );

                    return;
                }

                const backendPlayers =
                    result.data || [];

                const adminId =
                    result.room?.admin_id ||
                    room.adminId;

                let number = 1;

                const players: Player[] =
                    backendPlayers.map(
                        (item) => {
                            const cleanName =
                                item.display_name?.trim() ||
                                item.users?.name?.trim();

                            const player: Player = {
                                id: item.user_id,

                                name:
                                    cleanName ||
                                    'Player',

                                alive:
                                    item.status ===
                                    'alive',

                                role:
                                    item.role ||
                                    undefined,
                            };

                            if (
                                player.id !==
                                adminId
                            ) {
                                player.number =
                                    number++;
                            }

                            return player;
                        }
                    );

                setRoom((current) => ({
                    ...current,
                    players,
                    adminId,
                }));

                const disconnectedIds =
                    backendPlayers
                        .filter(
                            (item) =>
                                item.connection_status ===
                                'disconnected'
                        )
                        .map(
                            (item) =>
                                item.user_id
                        );

                setDisconnectedPlayerIds(
                    disconnectedIds
                );

                if (
                    disconnectedIds.length === 0
                ) {
                    setConnectionPaused(
                        false
                    );
                }
            } catch (error) {
                console.error(
                    'PLAYERS FETCH ERROR:',
                    error
                );
            } finally {
                setLoadingPlayers(false);
            }
        },
        [
            room.id,
            room.adminId,
        ]
    );

    useEffect(() => {
        loadPlayers();

        const interval =
            window.setInterval(
                loadPlayers,
                2000
            );

        return () =>
            window.clearInterval(
                interval
            );
    }, [loadPlayers]);

    // ==================================================
    // CURRENT PLAYER
    // ==================================================

    const currentPlayer = useMemo(() => {
        if (!currentUserId) {
            return null;
        }

        return (
            room.players.find(
                (player) =>
                    player.id ===
                    currentUserId
            ) || null
        );
    }, [
        room.players,
        currentUserId,
    ]);

    const currentPlayerIsDead =
        currentPlayer
            ? !currentPlayer.alive
            : false;

    // ==================================================
    // DISCONNECTED PLAYERS
    // ==================================================

    const disconnectedPlayers =
        useMemo(() => {
            return room.players.filter(
                (player) =>
                    disconnectedPlayerIds.includes(
                        player.id
                    )
            );
        }, [
            room.players,
            disconnectedPlayerIds,
        ]);

    // ==================================================
    // LIVEKIT (camera + mic + remote video/audio)
    // ==================================================

    useEffect(() => {
        if (!currentUserId) return;

        let cancelled = false;

        const connectLiveKit = async () => {
            try {
                const {
                    data: { session },
                } =
                    await supabase.auth.getSession();

                if (
                    cancelled ||
                    !session?.access_token
                ) {
                    return;
                }

                const tokenRes = await fetch(
                    `${API}/rooms/${room.id}/livekit-token`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${session.access_token}`,
                        },
                    }
                );

                const tokenJson =
                    await tokenRes.json();

                if (
                    cancelled ||
                    !tokenJson.ok
                ) {
                    console.error(
                        'LIVEKIT TOKEN ERROR:',
                        tokenJson.error
                    );

                    setMediaError(
                        'Не вдалося підключитись до відео-сервера. Онови сторінку.'
                    );

                    return;
                }

                const lkRoom =
                    new LiveKitRoom();

                livekitRoomRef.current =
                    lkRoom;

                const upsertRemoteTrack = (
                    participant: RemoteParticipant,
                    track: RemoteTrack
                ) => {
                    setRemoteStreams(
                        (current) => {
                            const existing =
                                current[
                                    participant
                                        .identity
                                    ] ||
                                new MediaStream();

                            existing.addTrack(
                                track.mediaStreamTrack
                            );

                            return {
                                ...current,
                                [participant.identity]:
                                existing,
                            };
                        }
                    );
                };

                const removeRemoteTrack = (
                    participant: RemoteParticipant,
                    track: RemoteTrack
                ) => {
                    setRemoteStreams(
                        (current) => {
                            const existing =
                                current[
                                    participant
                                        .identity
                                    ];

                            if (!existing) {
                                return current;
                            }

                            existing.removeTrack(
                                track.mediaStreamTrack
                            );

                            return {
                                ...current,
                            };
                        }
                    );
                };

                lkRoom.on(
                    RoomEvent.TrackSubscribed,
                    (
                        track,
                        _publication: RemoteTrackPublication,
                        participant
                    ) =>
                        upsertRemoteTrack(
                            participant,
                            track
                        )
                );

                lkRoom.on(
                    RoomEvent.TrackUnsubscribed,
                    (
                        track,
                        _publication: RemoteTrackPublication,
                        participant
                    ) =>
                        removeRemoteTrack(
                            participant,
                            track
                        )
                );

                lkRoom.on(
                    RoomEvent.ParticipantDisconnected,
                    (participant) => {
                        setRemoteStreams(
                            (current) => {
                                const next = {
                                    ...current,
                                };

                                delete next[
                                    participant
                                        .identity
                                    ];

                                return next;
                            }
                        );
                    }
                );

                await lkRoom.connect(
                    LIVEKIT_URL,
                    tokenJson.token
                );

                if (cancelled) {
                    lkRoom.disconnect();

                    return;
                }

                try {
                    await lkRoom.localParticipant.setCameraEnabled(
                        true
                    );

                    await lkRoom.localParticipant.setMicrophoneEnabled(
                        true
                    );

                    const videoTrack =
                        lkRoom.localParticipant
                            .getTrackPublication(
                                Track.Source
                                    .Camera
                            )
                            ?.track
                            ?.mediaStreamTrack;

                    const audioTrack =
                        lkRoom.localParticipant
                            .getTrackPublication(
                                Track.Source
                                    .Microphone
                            )
                            ?.track
                            ?.mediaStreamTrack;

                    const tracks = [
                        videoTrack,
                        audioTrack,
                    ].filter(
                        (
                            t
                        ): t is MediaStreamTrack =>
                            !!t
                    );

                    const stream =
                        new MediaStream(
                            tracks
                        );

                    localStreamRef.current =
                        stream;

                    setLocalStream(stream);
                    setMediaError(null);
                } catch (error) {
                    console.error(
                        'MEDIA ERROR:',
                        error
                    );

                    const name =
                        error instanceof
                        DOMException
                            ? error.name
                            : '';

                    const friendlyMessage =
                        name ===
                        'NotAllowedError'
                            ? 'Доступ до камери/мікрофона заборонено в браузері. Дозволь доступ і онови сторінку.'
                            : name ===
                            'NotFoundError'
                                ? 'Камеру або мікрофон не знайдено. Перевір, чи підключений пристрій.'
                                : name ===
                                'NotReadableError' ||
                                (error instanceof
                                    DOMException &&
                                    /starting videoinput failed/i.test(
                                        error.message ||
                                        ''
                                    ))
                                    ? 'Камера вже використовується іншою програмою (Zoom, Teams, інша вкладка). Закрий її і онови сторінку.'
                                    : 'Не вдалося підключити камеру/мікрофон. Онови сторінку або перевір налаштування пристрою.';

                    setMediaError(
                        friendlyMessage
                    );
                }
            } catch (error) {
                console.error(
                    'LIVEKIT CONNECT ERROR:',
                    error
                );

                setMediaError(
                    'Не вдалося підключитись до відео-сервера. Онови сторінку.'
                );
            }
        };

        connectLiveKit();

        return () => {
            cancelled = true;

            livekitRoomRef.current?.disconnect();

            livekitRoomRef.current = null;

            localStreamRef.current = null;

            setLocalStream(null);

            setRemoteStreams({});
        };
    }, [
        currentUserId,
        room.id,
    ]);

    // ==================================================
    // DEAD => MIC OFF
    // ==================================================

    useEffect(() => {
        livekitRoomRef.current?.localParticipant
            .setMicrophoneEnabled(
                !currentPlayerIsDead
            )
            .catch((error) =>
                console.error(
                    'MIC TOGGLE ERROR:',
                    error
                )
            );
    }, [currentPlayerIsDead]);

    // ==================================================
    // SOCKET.IO (room / game events)
    // ==================================================

    useEffect(() => {

        if (!currentUserId) {
            return;
        }

        let cancelled = false;

        const connectSocket =
            async () => {
                const {
                    data: { session },
                } =
                    await supabase.auth.getSession();

                if (
                    cancelled ||
                    !session?.access_token
                ) {
                    return;
                }

                const socket = io(API, {
                    transports: [
                        'websocket',
                    ],
                    auth: {
                        token:
                        session.access_token,
                    },
                });

                socketRef.current =
                    socket;

                socket.on(
                    'connect',
                    () => {
                        console.log(
                            '[WEBRTC] socket connected'
                        );

                        socket.emit(
                            'join-room',
                            room.id
                        );
                    }
                );

                socket.on(
                    'room-error',
                    (
                        message: string
                    ) => {
                        console.error(
                            '[ROOM] room error:',
                            message
                        );
                    }
                );

                socket.on(
                    'player-disconnected',
                    ({
                         userId,
                     }: {
                        userId: string;
                    }) => {
                        console.log(
                            '[ROOM] player disconnected:',
                            userId
                        );

                        setDisconnectedPlayerIds(
                            (current) => {
                                if (
                                    current.includes(
                                        userId
                                    )
                                ) {
                                    return current;
                                }

                                return [
                                    ...current,
                                    userId,
                                ];
                            }
                        );

                        setConnectionPaused(
                            true
                        );

                        setIsPaused(true);
                    }
                );

                socket.on(
                    'player-reconnected',
                    ({
                         userId,
                     }: {
                        userId: string;
                    }) => {
                        console.log(
                            '[ROOM] player reconnected:',
                            userId
                        );

                        setDisconnectedPlayerIds(
                            (current) =>
                                current.filter(
                                    (id) =>
                                        id !==
                                        userId
                                )
                        );
                    }
                );

                socket.on(
                    'game-connection-paused',
                    () => {
                        console.log(
                            '[ROOM] GAME PAUSED'
                        );

                        setConnectionPaused(
                            true
                        );

                        setIsPaused(true);
                    }
                );

                socket.on(
                    'game-connection-resumed',
                    () => {
                        console.log(
                            '[ROOM] GAME RESUMED'
                        );

                        setConnectionPaused(
                            false
                        );

                        setIsPaused(false);

                        setDisconnectedPlayerIds(
                            []
                        );
                    }
                );

                socket.on(
                    'room-admin-changed',
                    ({
                         adminId,
                     }: {
                        adminId: string;
                    }) => {
                        setRoom(
                            (current) => ({
                                ...current,
                                adminId,
                            })
                        );
                    }
                );

                socket.on(
                    'game-started',
                    () => {
                        console.log(
                            '[ROOM] GAME STARTED'
                        );

                        setRoom(
                            (current) => ({
                                ...current,
                                phase: 'night',
                                currentPhaseIndex: 0,
                            })
                        );
                    }
                );

                socket.on(
                    'phase-changed',
                    (data: {
                        phase: string;
                        phaseIndex: number;
                        phaseStartedAt: string;
                        phaseEndsAt:
                            string | null;
                    }) => {
                        setRoom(
                            (current) => ({
                                ...current,
                                phase: data.phase as any,
                                currentPhaseIndex:
                                data.phaseIndex,
                            })
                        );

                        if (
                            data.phaseEndsAt
                        ) {
                            const remaining =
                                Math.max(
                                    0,
                                    Math.round(
                                        (new Date(
                                            data.phaseEndsAt
                                        ).getTime() -
                                            Date.now()) /
                                        1000
                                    )
                                );

                            setTimer(
                                remaining
                            );
                        } else {
                            setTimer(null);
                        }

                        setIsPaused(false);
                    }
                );

                socket.on(
                    'player-died',
                    (data: {
                        userId: string;
                        role:
                            string | null;
                    }) => {
                        setRoom(
                            (current) => ({
                                ...current,
                                players:
                                current.players.map(
                                    (p) =>
                                        p.id ===
                                        data.userId
                                            ? {
                                                ...p,
                                                alive: false,
                                                role:
                                                    (data.role as any) ||
                                                    p.role,
                                            }
                                            : p
                                ),
                            })
                        );
                    }
                );

                socket.on(
                    'voting-finished',
                    (data: {
                        eliminatedUserId:
                            string | null;
                        role:
                            string | null;
                    }) => {
                        if (
                            !data.eliminatedUserId
                        ) {
                            return;
                        }

                        setRoom(
                            (current) => ({
                                ...current,
                                players:
                                current.players.map(
                                    (p) =>
                                        p.id ===
                                        data.eliminatedUserId
                                            ? {
                                                ...p,
                                                alive: false,
                                                role:
                                                    (data.role as any) ||
                                                    p.role,
                                            }
                                            : p
                                ),
                            })
                        );
                    }
                );

                socket.on(
                    'vote-updated',
                    (data: {
                        tally: Record<
                            string,
                            number
                        >;
                    }) => {
                        setVoteTally(
                            data.tally
                        );
                    }
                );

                socket.on(
                    'night-action-result',
                    (data: {
                        type: string;
                        targetUserId: string;
                        result: boolean;
                    }) => {
                        setNightActionResult(
                            data
                        );
                    }
                );

                socket.on(
                    'game-over',
                    (data: {
                        winner:
                            | 'mafia'
                            | 'civilians';
                    }) => {
                        setWinner(
                            data.winner
                        );

                        setRoom(
                            (current) => ({
                                ...current,
                                phase: 'end',
                            })
                        );
                    }
                );
            };

        connectSocket();

        return () => {
            cancelled = true;

            const socket =
                socketRef.current;

            if (socket) {
                socket.disconnect();
            }

            socketRef.current = null;
        };
    }, [
        currentUserId,
        room.id,
    ]);

    // ==================================================
    // TIMER INITIALIZATION
    // ==================================================

    useEffect(() => {
        const currentPhase =
            GAME_PHASES.find(
                (phase) =>
                    phase.key === room.phase
            );

        if (
            currentPhase?.duration &&
            currentPhase.hasTimer
        ) {
            setTimer(
                currentPhase.duration
            );
        } else {
            setTimer(null);
        }
    }, [room.phase]);

    // ==================================================
    // NEXT PHASE
    // ==================================================

    const handleNextPhase =
        useCallback(async () => {
            if (!isAdmin) return;

            try {
                const {
                    data: { session },
                } =
                    await supabase.auth.getSession();

                await fetch(
                    `${API}/rooms/${room.id}/next-phase`,
                    {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${session?.access_token}`,
                        },
                    }
                );
            } catch (error) {
                console.error(
                    'NEXT PHASE ERROR:',
                    error
                );
            }
        }, [
            isAdmin,
            room.id,
        ]);

    // ==================================================
    // NIGHT ACTION / VOTE (backend-authoritative)
    // ==================================================

    const submitNightAction =
        useCallback(
            async (
                type:
                    | 'mafia_kill'
                    | 'detective_inspect'
                    | 'doctor_heal'
                    | 'lover_action',
                targetUserId: string
            ) => {
                try {
                    const {
                        data: { session },
                    } =
                        await supabase.auth.getSession();

                    const res =
                        await fetch(
                            `${API}/rooms/${room.id}/night-action`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type':
                                        'application/json',
                                    Authorization: `Bearer ${session?.access_token}`,
                                },
                                body: JSON.stringify(
                                    {
                                        type,
                                        targetUserId,
                                    }
                                ),
                            }
                        );

                    const json =
                        await res.json();

                    if (!json.ok) {
                        console.error(
                            'NIGHT ACTION REJECTED:',
                            json.error
                        );
                    }

                    return json;
                } catch (error) {
                    console.error(
                        'NIGHT ACTION ERROR:',
                        error
                    );

                    return {
                        ok: false,
                    };
                }
            },
            [room.id]
        );

    const submitVote =
        useCallback(
            async (
                targetUserId:
                    string | 'skip'
            ) => {
                try {
                    const {
                        data: { session },
                    } =
                        await supabase.auth.getSession();

                    const res =
                        await fetch(
                            `${API}/rooms/${room.id}/vote`,
                            {
                                method: 'POST',
                                headers: {
                                    'Content-Type':
                                        'application/json',
                                    Authorization: `Bearer ${session?.access_token}`,
                                },
                                body: JSON.stringify(
                                    {
                                        targetUserId:
                                        targetUserId ===
                                        'skip'
                                            ? undefined
                                            : targetUserId,
                                    }
                                ),
                            }
                        );

                    const json =
                        await res.json();

                    if (!json.ok) {
                        console.error(
                            'VOTE REJECTED:',
                            json.error
                        );
                    }

                    return json;
                } catch (error) {
                    console.error(
                        'VOTE ERROR:',
                        error
                    );

                    return {
                        ok: false,
                    };
                }
            },
            [room.id]
        );

    // ==================================================
    // TIMER (візуальний зворотній відлік; авторитетне
    // джерело — "phase-changed" з backend, див. нижче)
    // ==================================================

    useEffect(() => {
        if (
            timer === null ||
            isPaused
        ) {
            return;
        }

        const interval =
            window.setInterval(() => {
                setTimer((prev) => {
                    if (
                        prev === null ||
                        prev <= 1
                    ) {
                        window.clearInterval(
                            interval
                        );

                        return 0;
                    }

                    return prev - 1;
                });
            }, 1000);

        return () =>
            window.clearInterval(
                interval
            );
    }, [
        timer,
        isPaused,
    ]);

    // ==================================================
    // START GAME
    // ==================================================

    const handleStart = async () => {
        if (
            !isAdmin ||
            room.phase !== 'lobby'
        ) {
            return;
        }

        if (
            room.players.length < 2
        ) {
            alert(
                'Для початку гри потрібно щонайменше 2 гравці.'
            );

            return;
        }

        try {
            const {
                data: { session },
            } =
                await supabase.auth.getSession();

            if (!session?.access_token) {
                throw new Error(
                    'Сесія користувача не знайдена'
                );
            }

            const response =
                await fetch(
                    `${API}/rooms/${room.id}/start`,
                    {
                        method: 'POST',

                        headers: {
                            Authorization:
                                `Bearer ${session.access_token}`,
                        },
                    }
                );

            const result =
                await response.json();

            if (
                !response.ok ||
                !result.ok
            ) {
                throw new Error(
                    result.error ||
                    'Не вдалося розпочати гру'
                );
            }

            // Ролі вже призначені на backend і
            // прийдуть при наступному опитуванні
            // loadPlayers() (кожні 2с) — кожен побачить
            // лише свою власну роль.
            setRoom({
                ...room,

                phase: 'night',

                currentPhaseIndex: 0,
            });
        } catch (error) {
            console.error(
                'START GAME ERROR:',
                error
            );

            alert(
                error instanceof Error
                    ? error.message
                    : 'Помилка запуску гри'
            );
        }
    };

    // ==================================================
    // REPEAT
    // ==================================================

    const handleRepeatPhase = () => {
        const current =
            GAME_PHASES.find(
                (phase) =>
                    phase.key === room.phase
            );

        if (current?.duration) {
            setTimer(
                current.duration
            );
        }
    };

    // ==================================================
    // COPY
    // ==================================================

    const handleCopyId = async () => {
        try {
            await navigator.clipboard.writeText(
                room.id
            );

            alert(
                'Room ID скопійовано!'
            );
        } catch {
            alert(
                'Помилка копіювання'
            );
        }
    };

    // ==================================================
    // TRANSFER ADMIN
    // ==================================================

    const handleMakeAdmin =
        async (
            newAdminId: string
        ) => {
            if (
                !isAdmin ||
                room.phase !== 'lobby'
            ) {
                return;
            }

            const player =
                room.players.find(
                    (item) =>
                        item.id ===
                        newAdminId
                );

            if (!player) return;

            const confirmed =
                window.confirm(
                    `Передати права адміністратора гравцю "${player.name}"?`
                );

            if (!confirmed) return;

            try {
                setTransferringAdminId(
                    newAdminId
                );

                const {
                    data: { session },
                } =
                    await supabase.auth.getSession();

                if (!session?.access_token) {
                    throw new Error(
                        'Сесія користувача не знайдена'
                    );
                }

                const response =
                    await fetch(
                        `${API}/rooms/${room.id}/admin`,
                        {
                            method: 'POST',

                            headers: {
                                'Content-Type':
                                    'application/json',

                                Authorization:
                                    `Bearer ${session.access_token}`,
                            },

                            body: JSON.stringify({
                                newAdminId,
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
                        result.error ||
                        'Не вдалося передати адмінство'
                    );
                }

                setRoom((current) => {
                    let number = 1;

                    const players =
                        current.players.map(
                            (item) => {
                                if (
                                    item.id ===
                                    newAdminId
                                ) {
                                    return {
                                        ...item,
                                        number:
                                        undefined,
                                    };
                                }

                                return {
                                    ...item,
                                    number:
                                        number++,
                                };
                            }
                        );

                    return {
                        ...current,

                        adminId:
                        newAdminId,

                        players,
                    };
                });
            } catch (error) {
                console.error(
                    'TRANSFER ADMIN ERROR:',
                    error
                );

                alert(
                    error instanceof Error
                        ? error.message
                        : 'Помилка передачі адмінства'
                );
            } finally {
                setTransferringAdminId(
                    null
                );
            }
        };

    // ==================================================
    // LOGOUT / EXPLICIT LEAVE
    // ==================================================

    const handleLogout = async () => {
        try {
            const {
                data: { session },
            } =
                await supabase.auth.getSession();

            if (session?.access_token) {
                try {
                    await fetch(
                        `${API}/rooms/${room.id}/leave`,
                        {
                            method: 'DELETE',

                            headers: {
                                Authorization:
                                    `Bearer ${session.access_token}`,
                            },
                        }
                    );
                } catch (error) {
                    console.error(
                        'ROOM LEAVE ERROR:',
                        error
                    );
                }
            }

            socketRef.current?.emit(
                'leave-room'
            );

            socketRef.current?.disconnect();

            socketRef.current = null;

            livekitRoomRef.current?.disconnect();

            livekitRoomRef.current = null;

            localStreamRef.current
                ?.getTracks()
                .forEach(
                    (track) =>
                        track.stop()
                );

            localStreamRef.current = null;

            setLocalStream(null);
            setRemoteStreams({});

            await supabase.auth.signOut();

            localStorage.removeItem(
                'roomId'
            );

            localStorage.removeItem(
                `room_${room.id}`
            );

            window.location.href = '/';
        } catch (error) {
            console.error(
                'LOGOUT ERROR:',
                error
            );

            try {
                await supabase.auth.signOut();
            } catch {
                // ignore
            }

            localStorage.removeItem(
                'roomId'
            );

            window.location.href = '/';
        }
    };

    // ==================================================
    // CONNECTION DECISION
    // ==================================================

    const handleConnectionDecision = (
        decision:
            | 'wait'
            | 'continue'
    ) => {
        if (!isAdmin) {
            return;
        }

        socketRef.current?.emit(
            'connection-decision',
            decision
        );
    };

    // ==================================================
    // LAYOUT
    // ==================================================

    const isSmallRoom =
        room.players.filter(
            (player) =>
                player.id !==
                room.adminId
        ).length <= 8;

    // ==================================================
    // STREAM
    // ==================================================

    const getPlayerStream = (
        player: Player
    ): MediaStream | null => {
        if (
            player.id ===
            currentUserId
        ) {
            return localStream;
        }

        return (
            remoteStreams[player.id] ||
            null
        );
    };

    // ==================================================
    // RENDER
    // ==================================================

    return (
        <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
            <RoomConnectionBanner
                connectionPaused={connectionPaused}
                disconnectedPlayers={
                    disconnectedPlayers
                }
                isAdmin={isAdmin}
                onDecision={
                    handleConnectionDecision
                }
            />

            <RoomTable
                players={room.players}
                adminId={room.adminId}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                isSmallRoom={isSmallRoom}
                loadingPlayers={loadingPlayers}
                getPlayerStream={getPlayerStream}
                handleMakeAdmin={handleMakeAdmin}
                transferringAdminId={
                    transferringAdminId
                }
                roomPhase={room.phase}
            />

            <RoomSidebar
                room={room}
                playerName={playerName}
                currentUserId={currentUserId}
                myRole={currentPlayer?.role}
                currentPlayerIsDead={
                    currentPlayerIsDead
                }
                disconnectedPlayerIds={
                    disconnectedPlayerIds
                }
                localStream={localStream}
                mediaError={mediaError}
                timer={timer}
                isPaused={isPaused}
                isAdmin={isAdmin}
                voteTally={voteTally}
                nightActionResult={
                    nightActionResult
                }
                winner={winner}
                onNightAction={
                    submitNightAction
                }
                onVote={submitVote}
                handleLogout={handleLogout}
                handleCopyId={handleCopyId}
                setIsPaused={setIsPaused}
                handleRepeatPhase={
                    handleRepeatPhase
                }
                handleStart={handleStart}
                handleNextPhase={
                    handleNextPhase
                }
            />
        </div>
    );
}