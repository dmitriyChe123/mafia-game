import "dotenv/config";
import express, {
    NextFunction,
    Request,
    Response,
} from "express";
import cors from "cors";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import {
    createClient,
    SupabaseClient,
    User,
} from "@supabase/supabase-js";

// ======================================================
// ENV
// ======================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

const PORT =
    Number(process.env.PORT) || 3001;

if (!SUPABASE_URL) {
    throw new Error(
        "SUPABASE_URL is not defined"
    );
}

if (!SUPABASE_KEY) {
    throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is not defined"
    );
}

// ======================================================
// APP
// ======================================================

const app = express();

const httpServer =
    createServer(app);

const ALLOWED_ORIGINS = process.env
    .CLIENT_ORIGINS
    ? process.env.CLIENT_ORIGINS
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [
        "http://localhost:3000",
        "http://localhost:5173",
    ];

app.use(
    cors({
        origin: ALLOWED_ORIGINS,
        methods: [
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "OPTIONS",
        ],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
        ],
    })
);

app.use(express.json());

// Забороняємо браузеру кешувати будь-які API-відповіді —
// інакше можна побачити застарілий стан кімнати/гри
// або, як щойно трапилось, застарілу відповідь /health.
app.use((_req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    next();
});

// ======================================================
// SUPABASE
// ======================================================

const supaAdmin: SupabaseClient =
    createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );

const supaAuth: SupabaseClient =
    createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );

// ======================================================
// TYPES
// ======================================================

interface AuthenticatedRequest
    extends Request {
    user?: User;
}

interface CreateRoomBody {
    name?: string;
    playerName?: string;
}

interface JoinRoomBody {
    roomId?: string;
    playerName?: string;
}

interface TransferAdminBody {
    newAdminId?: string;
}

// ======================================================
// CONNECTION STATE
// ======================================================

type ConnectionDecision =
    | "wait"
    | "continue"
    | null;

interface RoomConnectionState {
    disconnectedUsers: Set<string>;

    paused: boolean;

    decision: ConnectionDecision;
}

const roomConnectionStates =
    new Map<
        string,
        RoomConnectionState
    >();

function getRoomConnectionState(
    roomId: string
): RoomConnectionState {
    let state =
        roomConnectionStates.get(
            roomId
        );

    if (!state) {
        state = {
            disconnectedUsers:
                new Set<string>(),

            paused: false,

            decision: null,
        };

        roomConnectionStates.set(
            roomId,
            state
        );
    }

    return state;
}

function cleanupRoomConnectionState(
    roomId: string
) {
    const state =
        roomConnectionStates.get(
            roomId
        );

    if (!state) {
        return;
    }

    if (
        state.disconnectedUsers.size ===
        0 &&
        !state.paused &&
        state.decision === null
    ) {
        roomConnectionStates.delete(
            roomId
        );
    }
}

// ======================================================
// AUTH
// ======================================================

async function requireAuth(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    try {
        const authHeader =
            req.headers.authorization;

        if (
            !authHeader?.startsWith(
                "Bearer "
            )
        ) {
            return res.status(401).json({
                ok: false,
                error:
                    "Authorization token required",
            });
        }

        const token =
            authHeader.substring(7);

        const {
            data: { user },
            error,
        } =
            await supaAuth.auth.getUser(
                token
            );

        if (error || !user) {
            return res.status(401).json({
                ok: false,
                error:
                    "Invalid authorization token",
            });
        }

        req.user = user;

        next();
    } catch (error) {
        console.error(
            "AUTH ERROR:",
            error
        );

        return res.status(401).json({
            ok: false,
            error:
                "Authentication failed",
        });
    }
}

// ======================================================
// HEALTH
// ======================================================

app.get(
    "/health",
    (
        _req: Request,
        res: Response
    ) => {
        res.json({
            ok: true,
            service:
                "mafia-server",
        });
    }
);

// ======================================================
// CREATE ROOM
// ======================================================

app.post(
    "/rooms",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const user = req.user;

            if (!user) {
                return res.status(401).json({
                    ok: false,
                    error:
                        "User not authenticated",
                });
            }

            const body =
                req.body as CreateRoomBody;

            const roomName =
                body.name?.trim() ||
                "Mafia Room";

            const playerName =
                body.playerName?.trim() ||
                "Player";

            const {
                data: room,
                error,
            } =
                await supaAdmin
                    .from("rooms")
                    .insert([
                        {
                            name: roomName,
                            admin_id:
                            user.id,
                            created_by:
                            user.id,
                            room_type:
                                "private",
                            room_size:
                                "small",
                            status:
                                "waiting",
                        },
                    ])
                    .select()
                    .single();

            if (error) {
                throw error;
            }

            const {
                error: playerError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .insert([
                        {
                            room_id:
                            room.id,
                            user_id:
                            user.id,
                            display_name:
                            playerName,
                            status:
                                "alive",
                            connection_status:
                                "connected",
                            last_seen_at:
                                new Date().toISOString(),
                        },
                    ]);

            if (playerError) {
                await supaAdmin
                    .from("rooms")
                    .delete()
                    .eq(
                        "id",
                        room.id
                    );

                throw playerError;
            }

            return res.json({
                ok: true,
                data: room,
            });
        } catch (error) {
            console.error(
                "CREATE ROOM ERROR:",
                error
            );

            return res.status(400).json({
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to create room",
            });
        }
    }
);

// ======================================================
// GET ROOM
// ======================================================

app.get(
    "/rooms/:id",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const roomId =
                req.params.id;

            const {
                data: room,
                error,
            } =
                await supaAdmin
                    .from("rooms")
                    .select("*")
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (error) {
                throw error;
            }

            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error:
                        "Room not found",
                });
            }

            return res.json({
                ok: true,
                data: room,
            });
        } catch (error) {
            console.error(
                "GET ROOM ERROR:",
                error
            );

            return res.status(400).json({
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to get room",
            });
        }
    }
);

// ======================================================
// JOIN / RECONNECT
// ======================================================

app.post(
    "/rooms/join",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const user = req.user;

            if (!user) {
                return res.status(401).json({
                    ok: false,
                    error:
                        "User not authenticated",
                });
            }

            const body =
                req.body as JoinRoomBody;

            const roomId =
                body.roomId?.trim();

            const playerName =
                body.playerName?.trim() ||
                "Player";

            if (!roomId) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Room ID required",
                });
            }

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select("*")
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (roomError) {
                throw roomError;
            }

            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error:
                        "Room not found",
                });
            }

            // ==================================================
            // EXISTING PLAYER
            // ==================================================

            const {
                data: existingPlayer,
                error: existingError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select("*")
                    .eq(
                        "room_id",
                        roomId
                    )
                    .eq(
                        "user_id",
                        user.id
                    )
                    .maybeSingle();

            if (existingError) {
                throw existingError;
            }

            if (existingPlayer) {
                const {
                    data:
                        updatedPlayer,
                    error:
                        reconnectError,
                } =
                    await supaAdmin
                        .from(
                            "players_in_room"
                        )
                        .update({
                            display_name:
                            playerName,
                            connection_status:
                                "connected",
                            last_seen_at:
                                new Date().toISOString(),
                        })
                        .eq(
                            "room_id",
                            roomId
                        )
                        .eq(
                            "user_id",
                            user.id
                        )
                        .select()
                        .single();

                if (
                    reconnectError
                ) {
                    throw reconnectError;
                }

                return res.json({
                    ok: true,
                    alreadyJoined:
                        true,
                    reconnected:
                        true,
                    data:
                    updatedPlayer,
                    roomStatus:
                    room.status,
                });
            }

            // ==================================================
            // NEW PLAYER
            // ==================================================

            if (
                room.status !==
                "waiting"
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Гра вже розпочата. Нові гравці не можуть приєднатися.",
                });
            }

            const {
                data: player,
                error: joinError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .insert([
                        {
                            room_id:
                            roomId,
                            user_id:
                            user.id,
                            display_name:
                            playerName,
                            status:
                                "alive",
                            connection_status:
                                "connected",
                            last_seen_at:
                                new Date().toISOString(),
                        },
                    ])
                    .select()
                    .single();

            if (joinError) {
                throw joinError;
            }

            return res.json({
                ok: true,
                alreadyJoined:
                    false,
                reconnected:
                    false,
                data: player,
                roomStatus:
                room.status,
            });
        } catch (error) {
            console.error(
                "JOIN ROOM ERROR:",
                error
            );

            return res.status(400).json({
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to join room",
            });
        }
    }
);

// ======================================================
// START GAME
// ======================================================

app.post(
    "/rooms/:id/start",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const user = req.user;

            if (!user) {
                return res.status(401).json({
                    ok: false,
                    error:
                        "User not authenticated",
                });
            }

            const roomId =
                req.params.id;

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, admin_id, status"
                    )
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (roomError) {
                throw roomError;
            }

            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error:
                        "Room not found",
                });
            }

            if (
                room.admin_id !==
                user.id
            ) {
                return res.status(403).json({
                    ok: false,
                    error:
                        "Only admin can start the game",
                });
            }

            if (
                room.status !==
                "waiting"
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Game has already started",
                });
            }

            const {
                data: players,
                error:
                    playersError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select(
                        "user_id"
                    )
                    .eq(
                        "room_id",
                        roomId
                    );

            if (playersError) {
                throw playersError;
            }

            if (
                !players ||
                players.length < 2
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Для початку гри потрібно щонайменше 2 гравці.",
                });
            }

            const {
                data:
                    updatedRoom,
                error:
                    updateError,
            } =
                await supaAdmin
                    .from("rooms")
                    .update({
                        status:
                            "playing",
                        updated_at:
                            new Date().toISOString(),
                    })
                    .eq(
                        "id",
                        roomId
                    )
                    .eq(
                        "admin_id",
                        user.id
                    )
                    .eq(
                        "status",
                        "waiting"
                    )
                    .select()
                    .single();

            if (updateError) {
                throw updateError;
            }

            roomConnectionStates.delete(
                roomId
            );

            await supaAdmin
                .from(
                    "players_in_room"
                )
                .update({
                    connection_status:
                        "connected",
                    last_seen_at:
                        new Date().toISOString(),
                })
                .eq(
                    "room_id",
                    roomId
                );

            io.to(roomId).emit(
                "game-started"
            );

            return res.json({
                ok: true,
                data:
                updatedRoom,
            });
        } catch (error) {
            console.error(
                "START GAME ERROR:",
                error
            );

            return res.status(400).json({
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to start game",
            });
        }
    }
);

// ======================================================
// EXPLICIT LEAVE
// ======================================================

app.delete(
    "/rooms/:id/leave",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const user = req.user;

            if (!user) {
                return res.status(401).json({
                    ok: false,
                    error:
                        "User not authenticated",
                });
            }

            const roomId =
                req.params.id;

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, admin_id, status"
                    )
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (roomError) {
                throw roomError;
            }

            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error:
                        "Room not found",
                });
            }

            const {
                data: player,
                error:
                    playerError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select(
                        "id, user_id"
                    )
                    .eq(
                        "room_id",
                        roomId
                    )
                    .eq(
                        "user_id",
                        user.id
                    )
                    .maybeSingle();

            if (playerError) {
                throw playerError;
            }

            if (!player) {
                return res.json({
                    ok: true,
                    alreadyLeft:
                        true,
                });
            }

            // --------------------------------------------------
            // Mark explicit leave FIRST in memory.
            //
            // This prevents a following socket disconnect
            // from treating the player as accidental.
            // --------------------------------------------------

            const state =
                roomConnectionStates.get(
                    roomId
                );

            if (state) {
                state.disconnectedUsers.delete(
                    user.id
                );
            }

            // --------------------------------------------------
            // Delete player.
            // --------------------------------------------------

            const {
                error:
                    deleteError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .delete()
                    .eq(
                        "room_id",
                        roomId
                    )
                    .eq(
                        "user_id",
                        user.id
                    );

            if (deleteError) {
                throw deleteError;
            }

            // --------------------------------------------------
            // Notify peers.
            // --------------------------------------------------

            io.to(roomId).emit(
                "player-left",
                {
                    userId:
                    user.id,
                }
            );

            // --------------------------------------------------
            // Admin leaves waiting room.
            // --------------------------------------------------

            if (
                room.admin_id ===
                user.id &&
                room.status ===
                "waiting"
            ) {
                const {
                    data:
                        nextPlayer,
                    error:
                        nextPlayerError,
                } =
                    await supaAdmin
                        .from(
                            "players_in_room"
                        )
                        .select(
                            "user_id"
                        )
                        .eq(
                            "room_id",
                            roomId
                        )
                        .order(
                            "joined_at",
                            {
                                ascending:
                                    true,
                            }
                        )
                        .limit(1)
                        .maybeSingle();

                if (
                    nextPlayerError
                ) {
                    throw nextPlayerError;
                }

                if (nextPlayer) {
                    await supaAdmin
                        .from(
                            "rooms"
                        )
                        .update({
                            admin_id:
                            nextPlayer.user_id,
                            updated_at:
                                new Date().toISOString(),
                        })
                        .eq(
                            "id",
                            roomId
                        );

                    io.to(roomId).emit(
                        "room-admin-changed",
                        {
                            adminId:
                            nextPlayer.user_id,
                        }
                    );
                }
            }

            // --------------------------------------------------
            // If nobody is disconnected anymore,
            // clear connection state.
            // --------------------------------------------------

            cleanupRoomConnectionState(
                roomId
            );

            return res.json({
                ok: true,
            });
        } catch (error) {
            console.error(
                "LEAVE ROOM ERROR:",
                error
            );

            return res.status(400).json({
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to leave room",
            });
        }
    }
);

// ======================================================
// TRANSFER ADMIN
// ======================================================

app.post(
    "/rooms/:id/admin",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const user = req.user;

            if (!user) {
                return res.status(401).json({
                    ok: false,
                    error:
                        "User not authenticated",
                });
            }

            const roomId =
                req.params.id;

            const body =
                req.body as TransferAdminBody;

            const newAdminId =
                body.newAdminId?.trim();

            if (!newAdminId) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "New admin ID required",
                });
            }

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, admin_id, status"
                    )
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (roomError) {
                throw roomError;
            }

            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error:
                        "Room not found",
                });
            }

            if (
                room.admin_id !==
                user.id
            ) {
                return res.status(403).json({
                    ok: false,
                    error:
                        "Only current admin can transfer admin rights",
                });
            }

            if (
                room.status !==
                "waiting"
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Admin can only be changed while waiting",
                });
            }

            const {
                data:
                    newAdminPlayer,
                error:
                    playerError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select(
                        "id, user_id, room_id"
                    )
                    .eq(
                        "room_id",
                        roomId
                    )
                    .eq(
                        "user_id",
                        newAdminId
                    )
                    .maybeSingle();

            if (playerError) {
                throw playerError;
            }

            if (!newAdminPlayer) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Player is not in this room",
                });
            }

            const {
                data:
                    updatedRoom,
                error:
                    updateError,
            } =
                await supaAdmin
                    .from("rooms")
                    .update({
                        admin_id:
                        newAdminId,
                        updated_at:
                            new Date().toISOString(),
                    })
                    .eq(
                        "id",
                        roomId
                    )
                    .eq(
                        "admin_id",
                        user.id
                    )
                    .eq(
                        "status",
                        "waiting"
                    )
                    .select()
                    .single();

            if (updateError) {
                throw updateError;
            }

            io.to(roomId).emit(
                "room-admin-changed",
                {
                    adminId:
                    newAdminId,
                }
            );

            return res.json({
                ok: true,
                data:
                updatedRoom,
            });
        } catch (error) {
            console.error(
                "TRANSFER ADMIN ERROR:",
                error
            );

            return res.status(400).json({
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to transfer admin",
            });
        }
    }
);

// ======================================================
// GET PLAYERS
// ======================================================

app.get(
    "/rooms/:id/players",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const roomId =
                req.params.id;

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, admin_id, status"
                    )
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (roomError) {
                throw roomError;
            }

            if (!room) {
                return res.status(404).json({
                    ok: false,
                    error:
                        "Room not found",
                });
            }

            const {
                data: players,
                error:
                    playersError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select(`
                        id,
                        room_id,
                        user_id,
                        display_name,
                        role,
                        status,
                        joined_at,
                        connection_status,
                        last_seen_at
                    `)
                    .eq(
                        "room_id",
                        roomId
                    )
                    .order(
                        "joined_at",
                        {
                            ascending:
                                true,
                        }
                    );

            if (playersError) {
                throw playersError;
            }

            const userIds =
                (players || []).map(
                    (player) =>
                        player.user_id
                );

            let users: any[] =
                [];

            if (
                userIds.length >
                0
            ) {
                const {
                    data:
                        usersData,
                    error:
                        usersError,
                } =
                    await supaAdmin
                        .from("users")
                        .select(`
                            id,
                            name,
                            email,
                            avatar_url,
                            wins,
                            losses,
                            games_played,
                            is_premium,
                            premium_extra_time,
                            premium_profile_mod,
                            premium_frame_avatar,
                            premium_frame_camera,
                            created_at
                        `)
                        .in(
                            "id",
                            userIds
                        );

                if (usersError) {
                    throw usersError;
                }

                users =
                    usersData || [];
            }

            const usersMap =
                new Map(
                    users.map(
                        (user) => [
                            user.id,
                            user,
                        ]
                    )
                );

            const result =
                (players || []).map(
                    (player) => ({
                        ...player,

                        users:
                            usersMap.get(
                                player.user_id
                            ) ||
                            null,
                    })
                );

            return res.json({
                ok: true,

                room: {
                    id:
                    room.id,

                    admin_id:
                    room.admin_id,

                    status:
                    room.status,
                },

                data: result,
            });
        } catch (error) {
            console.error(
                "GET PLAYERS ERROR:",
                error
            );

            return res.status(400).json({
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to get players",
            });
        }
    }
);

// ======================================================
// SOCKET TYPES
// ======================================================

interface SocketData {
    userId: string;
    roomId?: string;
}
interface ClientToServerEvents {
    "join-room": (
        roomId: string
    ) => void;

    "webrtc-signal": (
        payload: {
            to: string;

            type:
                | "offer"
                | "answer"
                | "ice-candidate";

            data: unknown;
        }
    ) => void;

    "leave-room": () => void;

    "connection-decision": (
        decision:
            | "wait"
            | "continue"
    ) => void;
}

interface ServerToClientEvents {
    "room-error": (
        message: string
    ) => void;

    "room-peers": (
        peers: {
            socketId: string;
            userId: string;
        }[]
    ) => void;

    "peer-joined": (
        peer: {
            socketId: string;
            userId: string;
        }
    ) => void;

    "webrtc-signal": (
        signal: {
            fromSocketId: string;
            fromUserId: string;

            type:
                | "offer"
                | "answer"
                | "ice-candidate";

            data: unknown;
        }
    ) => void;

    "peer-left": (
        peer: {
            socketId: string;
            userId: string;
        }
    ) => void;

    "player-left": (
        data: {
            userId: string;
        }
    ) => void;

    "player-disconnected": (
        data: {
            userId: string;
        }
    ) => void;

    "player-reconnected": (
        data: {
            userId: string;
        }
    ) => void;

    "game-connection-paused": (
        data: {
            userId: string;
        }
    ) => void;

    "game-connection-resumed":
        () => void;

    "room-admin-changed": (
        data: {
            adminId: string;
        }
    ) => void;

    "game-started": () => void;
}

// ======================================================
// SOCKET.IO
// ======================================================

const io =
    new Server<
        ClientToServerEvents,
        ServerToClientEvents,
        {},
        SocketData
    >(
        httpServer,
        {
            cors: {
                origin:
                ALLOWED_ORIGINS,

                methods: [
                    "GET",
                    "POST",
                ],
            },
        }
    );

// ======================================================
// SOCKET AUTH
// ======================================================

io.use(
    async (
        socket,
        next
    ) => {
        try {
            const token =
                socket.handshake
                    .auth?.token;

            if (!token) {
                return next(
                    new Error(
                        "Authentication token required"
                    )
                );
            }

            const {
                data: {
                    user,
                },
                error,
            } =
                await supaAuth.auth.getUser(
                    token
                );

            if (
                error ||
                !user
            ) {
                return next(
                    new Error(
                        "Invalid authentication token"
                    )
                );
            }

            socket.data.userId =
                user.id;

            next();
        } catch (error) {
            console.error(
                "SOCKET AUTH ERROR:",
                error
            );

            next(
                new Error(
                    "Socket authentication failed"
                )
            );
        }
    }
);

// ======================================================
// SOCKET CONNECTION
// ======================================================

io.on(
    "connection",
    (socket) => {
        console.log(
            `[SOCKET] connected ${socket.id} user=${socket.data.userId}`
        );

        // ==================================================
        // JOIN ROOM
        // ==================================================

        socket.on(
            "join-room",
            async (
                roomId
            ) => {
                try {
                    const userId =
                        socket.data.userId;

                    if (
                        socket.data.roomId
                    ) {
                        return;
                    }

                    const {
                        data: room,
                        error:
                            roomError,
                    } =
                        await supaAdmin
                            .from(
                                "rooms"
                            )
                            .select(
                                "id, admin_id, status"
                            )
                            .eq(
                                "id",
                                roomId
                            )
                            .maybeSingle();

                    if (roomError) {
                        throw roomError;
                    }

                    if (!room) {
                        socket.emit(
                            "room-error",
                            "Кімнату не знайдено"
                        );

                        return;
                    }

                    // ==================================================
                    // PLAYER MUST ALREADY EXIST
                    // ==================================================

                    const {
                        data: player,
                        error,
                    } =
                        await supaAdmin
                            .from(
                                "players_in_room"
                            )
                            .select(
                                "user_id, room_id, connection_status"
                            )
                            .eq(
                                "room_id",
                                roomId
                            )
                            .eq(
                                "user_id",
                                userId
                            )
                            .maybeSingle();

                    if (error) {
                        throw error;
                    }

                    if (!player) {
                        socket.emit(
                            "room-error",
                            "Ви не є гравцем цієї кімнати"
                        );

                        return;
                    }

                    const state =
                        getRoomConnectionState(
                            roomId
                        );

                    const wasDisconnected =
                        state
                            .disconnectedUsers
                            .has(
                                userId
                            ) ||
                        player.connection_status ===
                        "disconnected";

                    state.disconnectedUsers.delete(
                        userId
                    );

                    await supaAdmin
                        .from(
                            "players_in_room"
                        )
                        .update({
                            connection_status:
                                "connected",

                            last_seen_at:
                                new Date().toISOString(),
                        })
                        .eq(
                            "room_id",
                            roomId
                        )
                        .eq(
                            "user_id",
                            userId
                        );

                    socket.data.roomId =
                        roomId;

                    // ==================================================
                    // EXISTING SOCKETS
                    // ==================================================

                    const existingSockets =
                        await io
                            .in(
                                roomId
                            )
                            .fetchSockets();

                    const peers =
                        existingSockets
                            .filter(
                                (
                                    peer
                                ) =>
                                    peer.id !==
                                    socket.id
                            )
                            .map(
                                (
                                    peer
                                ) => ({
                                    socketId:
                                    peer.id,

                                    userId:
                                    peer.data
                                        .userId,
                                })
                            );

                    socket.join(
                        roomId
                    );

                    socket.emit(
                        "room-peers",
                        peers
                    );

                    socket.to(
                        roomId
                    ).emit(
                        "peer-joined",
                        {
                            socketId:
                            socket.id,

                            userId,
                        }
                    );

                    // ==================================================
                    // RECONNECT
                    // ==================================================

                    if (
                        wasDisconnected
                    ) {
                        io.to(
                            roomId
                        ).emit(
                            "player-reconnected",
                            {
                                userId,
                            }
                        );

                        /*
                         * WAIT mode:
                         *
                         * When the last disconnected player
                         * returns, automatically resume.
                         */

                        if (
                            room.status ===
                            "playing" &&
                            state
                                .disconnectedUsers
                                .size ===
                            0 &&
                            state.decision ===
                            "wait"
                        ) {
                            state.paused =
                                false;

                            state.decision =
                                null;

                            io.to(
                                roomId
                            ).emit(
                                "game-connection-resumed"
                            );
                        }
                    }

                    console.log(
                        `[SOCKET] ${userId} joined room ${roomId} status=${room.status}`
                    );
                } catch (error) {
                    console.error(
                        "[SOCKET] JOIN ROOM ERROR:",
                        error
                    );

                    socket.emit(
                        "room-error",
                        "Не вдалося підключитися до кімнати"
                    );
                }
            }
        );

        // ==================================================
        // CONNECTION DECISION
        // ==================================================

        socket.on(
            "connection-decision",
            async (
                decision
            ) => {
                try {
                    const roomId =
                        socket.data.roomId;

                    const userId =
                        socket.data.userId;

                    if (!roomId) {
                        return;
                    }

                    const {
                        data: room,
                        error,
                    } =
                        await supaAdmin
                            .from(
                                "rooms"
                            )
                            .select(
                                "admin_id, status"
                            )
                            .eq(
                                "id",
                                roomId
                            )
                            .maybeSingle();

                    if (error) {
                        throw error;
                    }

                    if (!room) {
                        return;
                    }

                    if (
                        room.admin_id !==
                        userId
                    ) {
                        console.warn(
                            `[SOCKET] ${userId} attempted connection decision without admin rights`
                        );

                        return;
                    }

                    if (
                        room.status !==
                        "playing"
                    ) {
                        return;
                    }

                    const state =
                        getRoomConnectionState(
                            roomId
                        );

                    if (
                        state
                            .disconnectedUsers
                            .size ===
                        0
                    ) {
                        return;
                    }

                    // ==================================================
                    // WAIT
                    // ==================================================

                    if (
                        decision ===
                        "wait"
                    ) {
                        state.paused =
                            true;

                        state.decision =
                            "wait";

                        const firstDisconnectedUser =
                            [
                                ...state
                                    .disconnectedUsers,
                            ][0];

                        io.to(
                            roomId
                        ).emit(
                            "game-connection-paused",
                            {
                                userId:
                                firstDisconnectedUser,
                            }
                        );

                        console.log(
                            `[GAME] room=${roomId} PAUSED / WAIT`
                        );

                        return;
                    }

                    // ==================================================
                    // CONTINUE
                    // ==================================================

                    if (
                        decision ===
                        "continue"
                    ) {
                        state.paused =
                            false;

                        state.decision =
                            "continue";

                        io.to(
                            roomId
                        ).emit(
                            "game-connection-resumed"
                        );

                        console.log(
                            `[GAME] room=${roomId} RESUMED / CONTINUE`
                        );
                    }
                } catch (error) {
                    console.error(
                        "[SOCKET] CONNECTION DECISION ERROR:",
                        error
                    );
                }
            }
        );

        // ==================================================
        // WEBRTC SIGNAL
        // ==================================================

        socket.on(
            "webrtc-signal",
            (
                payload
            ) => {
                if (
                    !payload?.to ||
                    !payload?.type
                ) {
                    return;
                }

                io.to(
                    payload.to
                ).emit(
                    "webrtc-signal",
                    {
                        fromSocketId:
                        socket.id,

                        fromUserId:
                        socket.data
                            .userId,

                        type:
                        payload.type,

                        data:
                        payload.data,
                    }
                );
            }
        );

        // ==================================================
        // EXPLICIT SOCKET LEAVE
        // ==================================================

        socket.on(
            "leave-room",
            () => {
                void leaveSocketRoom(
                    socket,
                    true
                );
            }
        );

        // ==================================================
        // DISCONNECT
        // ==================================================

        socket.on(
            "disconnect",
            () => {
                void leaveSocketRoom(
                    socket,
                    false
                );

                console.log(
                    `[SOCKET] disconnected ${socket.id}`
                );
            }
        );
    }
);

// ======================================================
// SOCKET LEAVE
// ======================================================

async function leaveSocketRoom(
    socket: Socket,
    explicit: boolean
) {
    const roomId =
        socket.data.roomId;

    if (!roomId) {
        return;
    }

    const userId =
        socket.data.userId;

    // ==================================================
    // EXPLICIT LEAVE
    // ==================================================

    if (explicit) {
        socket.to(
            roomId
        ).emit(
            "peer-left",
            {
                socketId:
                socket.id,

                userId,
            }
        );

        socket.leave(
            roomId
        );

        socket.data.roomId =
            undefined;

        return;
    }

    // ==================================================
    // IMPORTANT:
    //
    // If the player was explicitly removed from DB
    // before socket disconnect happened, do NOT treat
    // this as accidental disconnect.
    // ==================================================

    const {
        data: existingPlayer,
        error:
            existingPlayerError,
    } =
        await supaAdmin
            .from(
                "players_in_room"
            )
            .select(
                "user_id, connection_status"
            )
            .eq(
                "room_id",
                roomId
            )
            .eq(
                "user_id",
                userId
            )
            .maybeSingle();

    if (existingPlayerError) {
        console.error(
            "[SOCKET] PLAYER CHECK ERROR:",
            existingPlayerError
        );
    }

    /*
     * Player no longer exists.
     *
     * That means this was an explicit leave.
     * Do not create disconnected state.
     */

    if (!existingPlayer) {
        socket.to(
            roomId
        ).emit(
            "peer-left",
            {
                socketId:
                socket.id,

                userId,
            }
        );

        socket.leave(
            roomId
        );

        socket.data.roomId =
            undefined;

        return;
    }

    // ==================================================
    // ACCIDENTAL DISCONNECT
    // ==================================================

    const state =
        getRoomConnectionState(
            roomId
        );

    state.disconnectedUsers.add(
        userId
    );

    const {
        data: room,
        error,
    } =
        await supaAdmin
            .from("rooms")
            .select(
                "status, admin_id"
            )
            .eq(
                "id",
                roomId
            )
            .maybeSingle();

    if (error) {
        console.error(
            "[SOCKET] DISCONNECT ROOM ERROR:",
            error
        );
    }

    const isPlaying =
        room?.status ===
        "playing";

    if (isPlaying) {
        state.paused =
            true;

        state.decision =
            null;
    }

    // ==================================================
    // DB
    // ==================================================

    await supaAdmin
        .from(
            "players_in_room"
        )
        .update({
            connection_status:
                "disconnected",

            last_seen_at:
                new Date().toISOString(),
        })
        .eq(
            "room_id",
            roomId
        )
        .eq(
            "user_id",
            userId
        );

    // ==================================================
    // WEBRTC
    // ==================================================

    socket.to(
        roomId
    ).emit(
        "peer-left",
        {
            socketId:
            socket.id,

            userId,
        }
    );

    // ==================================================
    // PLAYER DISCONNECTED
    // ==================================================

    socket.to(
        roomId
    ).emit(
        "player-disconnected",
        {
            userId,
        }
    );

    // ==================================================
    // GAME PAUSE
    // ==================================================

    if (isPlaying) {
        socket.to(
            roomId
        ).emit(
            "game-connection-paused",
            {
                userId,
            }
        );

        console.log(
            `[GAME] room=${roomId} PAUSED because user=${userId} disconnected`
        );
    }

    socket.leave(
        roomId
    );

    socket.data.roomId =
        undefined;
}

// ======================================================
// SERVER
// ======================================================

httpServer.listen(
    PORT,
    () => {
        console.log(
            `Server running on port ${PORT}`
        );

        console.log(
            `WebRTC signaling ready`
        );
    }
);