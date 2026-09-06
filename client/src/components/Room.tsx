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

import { RoomState, Player } from '../types';

import { nextPhase } from '../game/phaseManager';

import { GAME_PHASES } from '../game/phases';

import { assignRolesToPlayers } from '../game/roleAssigner';

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

interface SocketPeer {
    socketId: string;
    userId: string;
}

interface SignalMessage {
    fromSocketId: string;
    fromUserId: string;
    type:
        | 'offer'
        | 'answer'
        | 'ice-candidate';
    data: any;
}

const API =
    process.env.REACT_APP_API_URL ||
    'http://localhost:3001';

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

    const peerConnections =
        useRef<Map<string, RTCPeerConnection>>(
            new Map()
        );

    const peerSockets =
        useRef<Map<string, string>>(new Map());

    const pendingIceCandidates =
        useRef<
            Map<string, RTCIceCandidateInit[]>
        >(new Map());

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
    // CAMERA
    // ==================================================

    useEffect(() => {
        let mounted = true;

        const startMedia = async () => {
            try {
                const stream =
                    await navigator.mediaDevices.getUserMedia(
                        {
                            video: true,
                            audio: true,
                        }
                    );

                if (!mounted) {
                    stream
                        .getTracks()
                        .forEach(
                            (track) =>
                                track.stop()
                        );

                    return;
                }

                localStreamRef.current =
                    stream;

                setLocalStream(stream);
            } catch (error) {
                console.error(
                    'MEDIA ERROR:',
                    error
                );
            }
        };

        startMedia();

        return () => {
            mounted = false;

            localStreamRef.current
                ?.getTracks()
                .forEach(
                    (track) =>
                        track.stop()
                );

            localStreamRef.current = null;
        };
    }, []);

    // ==================================================
    // DEAD => MIC OFF
    // ==================================================

    useEffect(() => {
        if (!localStream) return;

        localStream
            .getAudioTracks()
            .forEach((track) => {
                track.enabled =
                    !currentPlayerIsDead;
            });
    }, [
        localStream,
        currentPlayerIsDead,
    ]);

    // ==================================================
    // WEBRTC HELPERS
    // ==================================================

    const closePeer = useCallback(
        (userId: string) => {
            const pc =
                peerConnections.current.get(
                    userId
                );

            if (pc) {
                pc.ontrack = null;
                pc.onicecandidate = null;
                pc.onconnectionstatechange =
                    null;

                pc.close();
            }

            peerConnections.current.delete(
                userId
            );

            peerSockets.current.delete(
                userId
            );

            pendingIceCandidates.current.delete(
                userId
            );

            setRemoteStreams(
                (current) => {
                    const next = {
                        ...current,
                    };

                    delete next[userId];

                    return next;
                }
            );
        },
        []
    );

    const createPeerConnection =
        useCallback(
            (
                peerUserId: string,
                peerSocketId: string
            ) => {
                const existing =
                    peerConnections.current.get(
                        peerUserId
                    );

                if (existing) {
                    peerSockets.current.set(
                        peerUserId,
                        peerSocketId
                    );

                    return existing;
                }

                console.log(
                    '[WEBRTC] creating peer connection:',
                    peerUserId
                );

                const pc =
                    new RTCPeerConnection({
                        iceServers: [
                            {
                                urls:
                                    'stun:stun.l.google.com:19302',
                            },
                        ],
                    });

                peerConnections.current.set(
                    peerUserId,
                    pc
                );

                peerSockets.current.set(
                    peerUserId,
                    peerSocketId
                );

                if (
                    localStreamRef.current
                ) {
                    localStreamRef.current
                        .getTracks()
                        .forEach((track) => {
                            pc.addTrack(
                                track,
                                localStreamRef.current!
                            );
                        });
                }

                pc.onicecandidate = (
                    event
                ) => {
                    if (
                        !event.candidate
                    ) {
                        return;
                    }

                    socketRef.current?.emit(
                        'webrtc-signal',
                        {
                            to: peerSocketId,
                            type: 'ice-candidate',
                            data: event.candidate.toJSON(),
                        }
                    );
                };

                pc.ontrack = (event) => {
                    const stream =
                        event.streams[0];

                    if (!stream) {
                        return;
                    }

                    console.log(
                        '[WEBRTC] remote stream received:',
                        peerUserId
                    );

                    setRemoteStreams(
                        (current) => ({
                            ...current,
                            [peerUserId]:
                            stream,
                        })
                    );
                };

                pc.onconnectionstatechange =
                    () => {
                        console.log(
                            '[WEBRTC]',
                            peerUserId,
                            'connection:',
                            pc.connectionState
                        );

                        if (
                            pc.connectionState ===
                            'failed' ||
                            pc.connectionState ===
                            'closed' ||
                            pc.connectionState ===
                            'disconnected'
                        ) {
                            closePeer(
                                peerUserId
                            );
                        }
                    };

                return pc;
            },
            [closePeer]
        );

    const createOffer = useCallback(
        async (
            peerUserId: string,
            peerSocketId: string
        ) => {
            const pc =
                createPeerConnection(
                    peerUserId,
                    peerSocketId
                );

            try {
                const offer =
                    await pc.createOffer();

                await pc.setLocalDescription(
                    offer
                );

                socketRef.current?.emit(
                    'webrtc-signal',
                    {
                        to: peerSocketId,
                        type: 'offer',
                        data: offer,
                    }
                );
            } catch (error) {
                console.error(
                    'CREATE OFFER ERROR:',
                    error
                );
            }
        },
        [createPeerConnection]
    );

    // ==================================================
    // SOCKET.IO + WEBRTC
    // ==================================================

    useEffect(() => {
        if (
            !currentUserId ||
            !localStream
        ) {
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
                            '[WEBRTC] room error:',
                            message
                        );
                    }
                );

                socket.on(
                    'room-peers',
                    async (
                        peers: SocketPeer[]
                    ) => {
                        for (
                            const peer of peers
                            ) {
                            if (
                                peer.userId ===
                                currentUserId
                            ) {
                                continue;
                            }

                            peerSockets.current.set(
                                peer.userId,
                                peer.socketId
                            );

                            createPeerConnection(
                                peer.userId,
                                peer.socketId
                            );

                            if (
                                currentUserId <
                                peer.userId
                            ) {
                                await createOffer(
                                    peer.userId,
                                    peer.socketId
                                );
                            }
                        }
                    }
                );

                socket.on(
                    'peer-joined',
                    async (
                        peer: SocketPeer
                    ) => {
                        if (
                            peer.userId ===
                            currentUserId
                        ) {
                            return;
                        }

                        peerSockets.current.set(
                            peer.userId,
                            peer.socketId
                        );

                        createPeerConnection(
                            peer.userId,
                            peer.socketId
                        );

                        if (
                            currentUserId <
                            peer.userId
                        ) {
                            await createOffer(
                                peer.userId,
                                peer.socketId
                            );
                        }
                    }
                );

                socket.on(
                    'webrtc-signal',
                    async (
                        signal: SignalMessage
                    ) => {
                        const {
                            fromUserId,
                            fromSocketId,
                            type,
                            data,
                        } = signal;

                        if (
                            fromUserId ===
                            currentUserId
                        ) {
                            return;
                        }

                        console.log(
                            '[WEBRTC] signal:',
                            type,
                            'from:',
                            fromUserId
                        );

                        peerSockets.current.set(
                            fromUserId,
                            fromSocketId
                        );

                        if (
                            type ===
                            'offer'
                        ) {
                            const pc =
                                createPeerConnection(
                                    fromUserId,
                                    fromSocketId
                                );

                            try {
                                await pc.setRemoteDescription(
                                    new RTCSessionDescription(
                                        data
                                    )
                                );

                                const queued =
                                    pendingIceCandidates.current.get(
                                        fromUserId
                                    ) || [];

                                for (
                                    const candidate of queued
                                    ) {
                                    try {
                                        await pc.addIceCandidate(
                                            new RTCIceCandidate(
                                                candidate
                                            )
                                        );
                                    } catch (
                                        error
                                        ) {
                                        console.error(
                                            '[WEBRTC] queued ICE error:',
                                            error
                                        );
                                    }
                                }

                                pendingIceCandidates.current.delete(
                                    fromUserId
                                );

                                const answer =
                                    await pc.createAnswer();

                                await pc.setLocalDescription(
                                    answer
                                );

                                socket.emit(
                                    'webrtc-signal',
                                    {
                                        to: fromSocketId,
                                        type: 'answer',
                                        data: answer,
                                    }
                                );
                            } catch (
                                error
                                ) {
                                console.error(
                                    '[WEBRTC] HANDLE OFFER ERROR:',
                                    error
                                );
                            }

                            return;
                        }

                        if (
                            type ===
                            'answer'
                        ) {
                            const pc =
                                peerConnections.current.get(
                                    fromUserId
                                );

                            if (!pc) {
                                console.warn(
                                    '[WEBRTC] answer received but PC missing:',
                                    fromUserId
                                );

                                return;
                            }

                            try {
                                await pc.setRemoteDescription(
                                    new RTCSessionDescription(
                                        data
                                    )
                                );

                                const queued =
                                    pendingIceCandidates.current.get(
                                        fromUserId
                                    ) || [];

                                for (
                                    const candidate of queued
                                    ) {
                                    try {
                                        await pc.addIceCandidate(
                                            new RTCIceCandidate(
                                                candidate
                                            )
                                        );
                                    } catch (
                                        error
                                        ) {
                                        console.error(
                                            '[WEBRTC] queued ICE error:',
                                            error
                                        );
                                    }
                                }

                                pendingIceCandidates.current.delete(
                                    fromUserId
                                );
                            } catch (
                                error
                                ) {
                                console.error(
                                    '[WEBRTC] HANDLE ANSWER ERROR:',
                                    error
                                );
                            }

                            return;
                        }

                        if (
                            type ===
                            'ice-candidate'
                        ) {
                            const pc =
                                peerConnections.current.get(
                                    fromUserId
                                );

                            if (!pc) {
                                console.warn(
                                    '[WEBRTC] ICE received but PC missing:',
                                    fromUserId
                                );

                                return;
                            }

                            const candidate =
                                data as RTCIceCandidateInit;

                            if (
                                !pc.remoteDescription
                            ) {
                                const queue =
                                    pendingIceCandidates.current.get(
                                        fromUserId
                                    ) || [];

                                queue.push(
                                    candidate
                                );

                                pendingIceCandidates.current.set(
                                    fromUserId,
                                    queue
                                );

                                return;
                            }

                            try {
                                await pc.addIceCandidate(
                                    new RTCIceCandidate(
                                        candidate
                                    )
                                );
                            } catch (
                                error
                                ) {
                                console.error(
                                    '[WEBRTC] ICE ERROR:',
                                    error
                                );
                            }
                        }
                    }
                );

                socket.on(
                    'peer-left',
                    ({
                         userId,
                     }: {
                        userId: string;
                    }) => {
                        closePeer(userId);
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

                        closePeer(userId);
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

            peerConnections.current.forEach(
                (pc) => pc.close()
            );

            peerConnections.current.clear();

            peerSockets.current.clear();

            pendingIceCandidates.current.clear();

            setRemoteStreams({});
        };
    }, [
        currentUserId,
        localStream,
        room.id,
        createPeerConnection,
        createOffer,
        closePeer,
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
        useCallback(() => {
            if (!isAdmin) return;

            const updated =
                nextPhase(room);

            setRoom(updated);
        }, [
            isAdmin,
            room,
        ]);

    // ==================================================
    // TIMER
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

                        if (isAdmin) {
                            handleNextPhase();
                        }

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
        isAdmin,
        handleNextPhase,
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

            const playersWithRoles =
                assignRolesToPlayers(
                    room.players
                );

            setRoom({
                ...room,

                players:
                playersWithRoles,

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

            peerConnections.current.forEach(
                (pc) => pc.close()
            );

            peerConnections.current.clear();

            peerSockets.current.clear();

            pendingIceCandidates.current.clear();

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
                currentPlayerIsDead={
                    currentPlayerIsDead
                }
                disconnectedPlayerIds={
                    disconnectedPlayerIds
                }
                localStream={localStream}
                timer={timer}
                isPaused={isPaused}
                isAdmin={isAdmin}
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