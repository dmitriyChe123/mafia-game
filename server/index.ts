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
import { AccessToken } from "livekit-server-sdk";
import { assignRoles } from "./game/roles";
import { GAME_PHASES } from "./game/phases";
import {
    normalizeRoomSize,
    ROOM_SIZE_TARGETS,
} from "./game/roomSize";

// ======================================================
// ENV
// ======================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

const LIVEKIT_API_KEY =
    process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET =
    process.env.LIVEKIT_API_SECRET;

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

if (
    !LIVEKIT_API_KEY ||
    !LIVEKIT_API_SECRET
) {
    console.warn(
        "[LIVEKIT] LIVEKIT_API_KEY / LIVEKIT_API_SECRET is not set — " +
        "/rooms/:id/livekit-token will fail until these are configured."
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
    roomSize?: string;
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

            const roomSize =
                normalizeRoomSize(
                    body.roomSize
                );

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
                            roomSize,
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
                count: currentPlayerCount,
                error: countError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select("id", {
                        count: "exact",
                        head: true,
                    })
                    .eq(
                        "room_id",
                        roomId
                    );

            if (countError) {
                throw countError;
            }

            const targetPlayers =
                ROOM_SIZE_TARGETS[
                    normalizeRoomSize(
                        room.room_size
                    )
                    ];

            if (
                (currentPlayerCount ||
                    0) >= targetPlayers
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Кімната вже заповнена.",
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
// MATCHMAKING
// ======================================================
//
// Алгоритм за ТЗ (розділ 7):
//   1. Якщо є waiting matchmaking-кімната цього
//      room_size з вільним місцем — приєднуємось.
//   2. Якщо ні — атомарно створюємо нову (унікальний
//      індекс rooms_one_waiting_matchmaking_per_size
//      гарантує, що при гонці двох запитів створиться
//      лише одна).
//   3. Коли кімната заповнюється до цільової кількості
//      — призначаємо admin і кімната більше не
//      вважається waiting-для-заповнення.

app.post(
    "/matchmaking/join",
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

            const roomSize =
                normalizeRoomSize(
                    (req.body as {
                        roomSize?: string;
                    }).roomSize
                );

            const targetPlayers =
                ROOM_SIZE_TARGETS[
                    roomSize
                    ];

            let joinedRoomId:
                string | null = null;

            // До 3 спроб: між "знайти" і "вставити
            // гравця" можлива гонка з іншими запитами
            // (кімната встигла заповнитись) — просто
            // пробуємо ще раз.
            for (
                let attempt = 0;
                attempt < 3 &&
                !joinedRoomId;
                attempt++
            ) {
                const {
                    data: waitingRoom,
                    error:
                        findError,
                } =
                    await supaAdmin
                        .from("rooms")
                        .select(
                            "id"
                        )
                        .eq(
                            "room_type",
                            "matchmaking"
                        )
                        .eq(
                            "room_size",
                            roomSize
                        )
                        .eq(
                            "matchmaking_open",
                            true
                        )
                        .order(
                            "created_at",
                            {
                                ascending:
                                    true,
                            }
                        )
                        .limit(1)
                        .maybeSingle();

                if (findError) {
                    throw findError;
                }

                let roomId =
                    waitingRoom?.id ||
                    null;

                if (!roomId) {
                    const {
                        data: createdRoom,
                        error:
                            createError,
                    } =
                        await supaAdmin
                            .from(
                                "rooms"
                            )
                            .insert([
                                {
                                    name: "Matchmaking Room",
                                    admin_id: null,
                                    created_by: null,
                                    room_type:
                                        "matchmaking",
                                    room_size:
                                    roomSize,
                                    status:
                                        "waiting",
                                },
                            ])
                            .select(
                                "id"
                            )
                            .single();

                    if (createError) {
                        // Унікальний індекс не дав
                        // створити другу waiting-кімнату
                        // цього розміру — хтось інший
                        // щойно її створив. Пробуємо
                        // знайти її на наступній ітерації.
                        if (
                            (createError as any)
                                .code === "23505"
                        ) {
                            continue;
                        }

                        throw createError;
                    }

                    roomId =
                        createdRoom.id;
                }

                const {
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
                                    user.user_metadata
                                        ?.name ||
                                    user.email?.split(
                                        "@"
                                    )[0] ||
                                    "Player",
                                status:
                                    "alive",
                                connection_status:
                                    "connected",
                                last_seen_at:
                                    new Date().toISOString(),
                            },
                        ]);

                if (joinError) {
                    // (room_id, user_id) unique —
                    // або кімната вже повна й хтось
                    // встиг раніше. Пробуємо ще раз.
                    continue;
                }

                joinedRoomId = roomId;

                const {
                    count: playerCount,
                    error: countError,
                } =
                    await supaAdmin
                        .from(
                            "players_in_room"
                        )
                        .select("id", {
                            count: "exact",
                            head: true,
                        })
                        .eq(
                            "room_id",
                            roomId
                        );

                if (countError) {
                    throw countError;
                }

                if (
                    (playerCount ||
                        0) >=
                    targetPlayers
                ) {
                    const {
                        data: firstPlayer,
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

                    await supaAdmin
                        .from("rooms")
                        .update({
                            admin_id:
                                firstPlayer?.user_id ||
                                user.id,

                            // Прибираємо з пулу
                            // "waiting matchmaking" —
                            // унікальний індекс звільняє
                            // місце для наступної кімнати
                            // цього розміру.
                            matchmaking_open:
                                false,
                        })
                        .eq(
                            "id",
                            roomId
                        );
                }
            }

            if (!joinedRoomId) {
                return res.status(409).json({
                    ok: false,
                    error:
                        "Не вдалося приєднатись до matchmaking. Спробуй ще раз.",
                });
            }

            return res.json({
                ok: true,
                data: {
                    roomId:
                    joinedRoomId,
                },
            });
        } catch (error) {
            console.error(
                "MATCHMAKING JOIN ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "Failed to join matchmaking",
            });
        }
    }
);

app.post(
    "/matchmaking/leave",
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

            const roomId = (
                req.body as {
                    roomId?: string;
                }
            ).roomId;

            if (!roomId) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "roomId required",
                });
            }

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, room_type, status"
                    )
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (roomError) {
                throw roomError;
            }

            if (
                !room ||
                room.room_type !==
                "matchmaking"
            ) {
                return res.status(404).json({
                    ok: false,
                    error:
                        "Matchmaking room not found",
                });
            }

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

            const {
                count: remaining,
                error: countError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select("id", {
                        count: "exact",
                        head: true,
                    })
                    .eq(
                        "room_id",
                        roomId
                    );

            if (countError) {
                throw countError;
            }

            if (
                (remaining || 0) ===
                0 &&
                room.status !==
                "playing"
            ) {
                // Порожня matchmaking-кімната —
                // прибираємо, щоб не накопичувати
                // сміттєві rooms (ТЗ 6.4).
                await supaAdmin
                    .from("rooms")
                    .delete()
                    .eq(
                        "id",
                        roomId
                    );
            } else if (
                room.status ===
                "waiting"
            ) {
                // Звільнилось місце до старту гри —
                // знову відкриваємо кімнату для
                // matchmaking (якщо вона була закрита
                // через заповнення).
                await supaAdmin
                    .from("rooms")
                    .update({
                        matchmaking_open:
                            true,
                    })
                    .eq(
                        "id",
                        roomId
                    );
            }

            return res.json({
                ok: true,
            });
        } catch (error) {
            console.error(
                "MATCHMAKING LEAVE ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "Failed to leave matchmaking",
            });
        }
    }
);

// ======================================================
// GAME ENGINE (authoritative phases / night / voting)
// ======================================================
//
// В пам'яті процесу — свідомий компроміс для MVP:
// нічні дії та голоси поточного раунду не переживуть
// рестарт backend-процесу (наприклад, redeploy на
// Render). Сама фаза/таймер персистяться в rooms
// (див. міграцію rooms_game_state_columns), тож
// reconnect і "хто на якій фазі" переживають рестарт —
// лише дії конкретної ночі/голосування довелось би
// повторити, якщо backend впаде рівно в цей момент.

type NightActionType =
    | "mafia_kill"
    | "detective_inspect"
    | "doctor_heal"
    | "lover_action";

interface NightAction {
    type: NightActionType;
    targetUserId: string;
}

const roomPhaseTimers =
    new Map<string, NodeJS.Timeout>();

const roomNightActions =
    new Map<
        string,
        Map<string, NightAction>
    >();

const roomVotes =
    new Map<
        string,
        Map<string, string>
    >();

const ROLE_NIGHT_ACTIONS: Record<
    string,
    NightActionType[]
> = {
    mafia: ["mafia_kill"],
    boss: ["mafia_kill"],
    detective: ["detective_inspect"],
    doctor: ["doctor_heal"],
    lover: ["lover_action"],
    civilian: [],
};

async function getRoomPlayers(
    roomId: string
) {
    const {
        data,
        error,
    } =
        await supaAdmin
            .from("players_in_room")
            .select(
                "user_id, role, status"
            )
            .eq("room_id", roomId);

    if (error) {
        throw error;
    }

    return data || [];
}

function computeWinner(
    players: {
        role: string | null;
        status: string;
    }[]
): "mafia" | "civilians" | null {
    const alive = players.filter(
        (p) => p.status === "alive"
    );

    const mafiaAlive = alive.filter(
        (p) =>
            p.role === "mafia" ||
            p.role === "boss"
    ).length;

    const othersAlive =
        alive.length - mafiaAlive;

    if (alive.length === 0) {
        return null;
    }

    if (mafiaAlive === 0) {
        return "civilians";
    }

    if (mafiaAlive >= othersAlive) {
        return "mafia";
    }

    return null;
}

function clearRoomTimer(
    roomId: string
) {
    const existing =
        roomPhaseTimers.get(roomId);

    if (existing) {
        clearTimeout(existing);
    }

    roomPhaseTimers.delete(roomId);
}

async function transitionToPhase(
    roomId: string,
    phaseIndex: number
) {
    const phaseConfig =
        GAME_PHASES[phaseIndex];

    const startedAt = new Date();

    const endsAt =
        phaseConfig.hasTimer &&
        phaseConfig.duration
            ? new Date(
                startedAt.getTime() +
                phaseConfig.duration *
                1000
            )
            : null;

    await supaAdmin
        .from("rooms")
        .update({
            phase: phaseConfig.key,
            phase_index: phaseIndex,
            phase_started_at:
                startedAt.toISOString(),
            phase_ends_at:
                endsAt
                    ? endsAt.toISOString()
                    : null,
        })
        .eq("id", roomId);

    io.to(roomId).emit(
        "phase-changed",
        {
            phase: phaseConfig.key,
            phaseIndex,
            phaseStartedAt:
                startedAt.toISOString(),
            phaseEndsAt:
                endsAt
                    ? endsAt.toISOString()
                    : null,
        }
    );

    clearRoomTimer(roomId);

    if (
        phaseConfig.hasTimer &&
        phaseConfig.duration
    ) {
        const timer = setTimeout(
            () => {
                advancePhase(
                    roomId
                ).catch((error) =>
                    console.error(
                        "AUTO ADVANCE ERROR:",
                        error
                    )
                );
            },
            phaseConfig.duration * 1000
        );

        roomPhaseTimers.set(
            roomId,
            timer
        );
    }
}

async function resolveNight(
    roomId: string
) {
    const actions =
        roomNightActions.get(
            roomId
        ) || new Map();

    const players =
        await getRoomPlayers(roomId);

    const killVotes = new Map<
        string,
        number
    >();

    let doctorHealTarget:
        string | null = null;

    const detectiveInspections: {
        actorId: string;
        targetId: string;
    }[] = [];

    for (const [
        actorId,
        action,
    ] of actions.entries()) {
        if (
            action.type ===
            "mafia_kill"
        ) {
            killVotes.set(
                action.targetUserId,
                (killVotes.get(
                        action.targetUserId
                    ) || 0) + 1
            );
        } else if (
            action.type ===
            "doctor_heal"
        ) {
            doctorHealTarget =
                action.targetUserId;
        } else if (
            action.type ===
            "detective_inspect"
        ) {
            detectiveInspections.push(
                {
                    actorId,
                    targetId:
                    action.targetUserId,
                }
            );
        }
    }

    let killTargetId:
        string | null = null;

    let maxKillVotes = 0;

    for (const [
        targetId,
        count,
    ] of killVotes.entries()) {
        if (count > maxKillVotes) {
            maxKillVotes = count;
            killTargetId = targetId;
        }
    }

    const saved =
        !!killTargetId &&
        killTargetId ===
        doctorHealTarget;

    if (killTargetId && !saved) {
        await supaAdmin
            .from(
                "players_in_room"
            )
            .update({
                status: "dead",
            })
            .eq(
                "room_id",
                roomId
            )
            .eq(
                "user_id",
                killTargetId
            );

        const deadPlayer =
            players.find(
                (p) =>
                    p.user_id ===
                    killTargetId
            );

        io.to(roomId).emit(
            "player-died",
            {
                userId:
                killTargetId,
                role:
                    deadPlayer?.role ||
                    null,
            }
        );
    }

    for (const inspection of detectiveInspections) {
        const target =
            players.find(
                (p) =>
                    p.user_id ===
                    inspection.targetId
            );

        const isMafia =
            target?.role ===
            "mafia" ||
            target?.role === "boss";

        io.to(
            `user:${inspection.actorId}`
        ).emit(
            "night-action-result",
            {
                type:
                    "detective_inspect",
                targetUserId:
                inspection.targetId,
                result: isMafia,
            }
        );
    }

    roomNightActions.delete(roomId);
}

async function resolveVoting(
    roomId: string
) {
    const votesForRoom =
        roomVotes.get(roomId) ||
        new Map();

    const tally = new Map<
        string,
        number
    >();

    for (const targetId of votesForRoom.values()) {
        if (targetId === "skip") {
            continue;
        }

        tally.set(
            targetId,
            (tally.get(targetId) ||
                0) + 1
        );
    }

    let eliminatedId:
        string | null = null;

    let maxVotes = 0;

    let isTie = false;

    for (const [
        targetId,
        count,
    ] of tally.entries()) {
        if (count > maxVotes) {
            maxVotes = count;
            eliminatedId = targetId;
            isTie = false;
        } else if (
            count === maxVotes &&
            maxVotes > 0
        ) {
            isTie = true;
        }
    }

    if (isTie) {
        eliminatedId = null;
    }

    if (eliminatedId) {
        await supaAdmin
            .from(
                "players_in_room"
            )
            .update({
                status: "dead",
            })
            .eq(
                "room_id",
                roomId
            )
            .eq(
                "user_id",
                eliminatedId
            );
    }

    const players =
        await getRoomPlayers(roomId);

    const eliminatedPlayer =
        eliminatedId
            ? players.find(
                (p) =>
                    p.user_id ===
                    eliminatedId
            )
            : null;

    io.to(roomId).emit(
        "voting-finished",
        {
            eliminatedUserId:
                eliminatedId,
            role:
                eliminatedPlayer?.role ||
                null,
        }
    );

    roomVotes.delete(roomId);
}

async function endGame(
    roomId: string,
    winner: "mafia" | "civilians"
) {
    clearRoomTimer(roomId);

    const endIndex =
        GAME_PHASES.findIndex(
            (p) => p.key === "end"
        );

    await supaAdmin
        .from("rooms")
        .update({
            status: "finished",
            phase: "end",
            phase_index: endIndex,
            phase_started_at:
                new Date().toISOString(),
            phase_ends_at: null,
            winner,
        })
        .eq("id", roomId);

    io.to(roomId).emit(
        "game-over",
        { winner }
    );

    roomNightActions.delete(roomId);
    roomVotes.delete(roomId);
}

async function advancePhase(
    roomId: string
) {
    const {
        data: room,
        error,
    } =
        await supaAdmin
            .from("rooms")
            .select(
                "id, status, phase_index, day_number"
            )
            .eq("id", roomId)
            .maybeSingle();

    if (error) {
        throw error;
    }

    if (!room || room.status !== "playing") {
        return;
    }

    const currentIndex =
        room.phase_index;

    const currentPhase =
        GAME_PHASES[currentIndex];

    if (!currentPhase) {
        return;
    }

    if (currentPhase.key === "night") {
        await resolveNight(roomId);
    }

    if (
        currentPhase.key === "voting"
    ) {
        await resolveVoting(roomId);
    }

    const players =
        await getRoomPlayers(roomId);

    const winner =
        computeWinner(players);

    if (winner) {
        await endGame(
            roomId,
            winner
        );

        return;
    }

    let nextIndex =
        currentIndex + 1;

    if (
        currentPhase.key === "voting" ||
        nextIndex >=
        GAME_PHASES.length
    ) {
        // Раунд завершився без переможця —
        // повертаємось на ніч наступного дня
        // (а не на role_distribution: ролі
        // роздаються рівно один раз за гру).
        nextIndex =
            GAME_PHASES.findIndex(
                (p) => p.key === "night"
            );

        await supaAdmin
            .from("rooms")
            .update({
                day_number:
                    (room.day_number ||
                        1) + 1,
            })
            .eq("id", roomId);
    }

    await transitionToPhase(
        roomId,
        nextIndex
    );
}

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
                        "id, admin_id, status, room_size"
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

            // ==========================================
            // АВТОРИТАТИВНА РОЗДАЧА РОЛЕЙ (backend-only)
            //
            // Ролі ніколи не обчислюються на frontend і
            // не потрапляють у спільний game-state —
            // кожен гравець отримує лише свою роль через
            // приватну socket-подію "your-role".
            // ==========================================

            const roles = assignRoles(
                players.length,
                normalizeRoomSize(
                    room.room_size
                )
            );

            const shuffledPlayers = [
                ...players,
            ].sort(
                () => Math.random() - 0.5
            );

            const assignments =
                shuffledPlayers.map(
                    (player, index) => ({
                        userId:
                        player.user_id,
                        role: roles[index],
                    })
                );

            await Promise.all(
                assignments.map(
                    ({ userId, role }) =>
                        supaAdmin
                            .from(
                                "players_in_room"
                            )
                            .update({
                                role,
                            })
                            .eq(
                                "room_id",
                                roomId
                            )
                            .eq(
                                "user_id",
                                userId
                            )
                )
            );

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

            await transitionToPhase(
                roomId,
                0
            );

            assignments.forEach(
                ({ userId, role }) => {
                    io.to(
                        `user:${userId}`
                    ).emit(
                        "your-role",
                        { role }
                    );
                }
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
// NEXT PHASE (admin-only manual advance)
// ======================================================

app.post(
    "/rooms/:id/next-phase",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const roomId =
                req.params.id;

            const userId =
                req.user!.id;

            const {
                data: room,
                error,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, admin_id, status, phase_index"
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
                return res.status(404).json({
                    ok: false,
                    error:
                        "Room not found",
                });
            }

            if (
                room.admin_id !==
                userId
            ) {
                return res.status(403).json({
                    ok: false,
                    error:
                        "Only admin can advance the phase",
                });
            }

            if (
                room.status !==
                "playing"
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Game is not currently playing",
                });
            }

            if (
                GAME_PHASES[
                    room.phase_index
                    ]?.key === "end"
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Game has already ended",
                });
            }

            await advancePhase(
                roomId
            );

            return res.json({
                ok: true,
            });
        } catch (error) {
            console.error(
                "NEXT PHASE ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "Failed to advance phase",
            });
        }
    }
);

// ======================================================
// NIGHT ACTION
// ======================================================

app.post(
    "/rooms/:id/night-action",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const roomId =
                req.params.id;

            const userId =
                req.user!.id;

            const {
                type,
                targetUserId,
            } = req.body as {
                type?: NightActionType;
                targetUserId?: string;
            };

            if (
                !type ||
                !targetUserId
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "type and targetUserId are required",
                });
            }

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, status, phase"
                    )
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (roomError) {
                throw roomError;
            }

            if (
                !room ||
                room.status !==
                "playing" ||
                room.phase !== "night"
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Night actions are only allowed during the night phase",
                });
            }

            const {
                data: actor,
                error: actorError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select(
                        "role, status"
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

            if (actorError) {
                throw actorError;
            }

            if (
                !actor ||
                actor.status !==
                "alive"
            ) {
                return res.status(403).json({
                    ok: false,
                    error:
                        "Only alive players can act",
                });
            }

            const allowedActions =
                ROLE_NIGHT_ACTIONS[
                    actor.role || ""
                    ] || [];

            if (
                !allowedActions.includes(
                    type
                )
            ) {
                return res.status(403).json({
                    ok: false,
                    error:
                        "Your role cannot perform this action",
                });
            }

            const {
                data: target,
                error: targetError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select("status")
                    .eq(
                        "room_id",
                        roomId
                    )
                    .eq(
                        "user_id",
                        targetUserId
                    )
                    .maybeSingle();

            if (targetError) {
                throw targetError;
            }

            if (
                !target ||
                target.status !==
                "alive"
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Target must be an alive player in this room",
                });
            }

            const actionsForRoom =
                roomNightActions.get(
                    roomId
                ) ||
                new Map<
                    string,
                    NightAction
                >();

            if (
                actionsForRoom.has(
                    userId
                )
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "You already acted this night",
                });
            }

            actionsForRoom.set(
                userId,
                {
                    type,
                    targetUserId,
                }
            );

            roomNightActions.set(
                roomId,
                actionsForRoom
            );

            return res.json({
                ok: true,
            });
        } catch (error) {
            console.error(
                "NIGHT ACTION ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "Failed to submit night action",
            });
        }
    }
);

// ======================================================
// VOTE
// ======================================================

app.post(
    "/rooms/:id/vote",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            const roomId =
                req.params.id;

            const userId =
                req.user!.id;

            const {
                targetUserId,
            } = req.body as {
                targetUserId?: string;
            };

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, status, phase"
                    )
                    .eq(
                        "id",
                        roomId
                    )
                    .maybeSingle();

            if (roomError) {
                throw roomError;
            }

            if (
                !room ||
                room.status !==
                "playing" ||
                room.phase !==
                "voting"
            ) {
                return res.status(400).json({
                    ok: false,
                    error:
                        "Voting is only allowed during the voting phase",
                });
            }

            const {
                data: voter,
                error: voterError,
            } =
                await supaAdmin
                    .from(
                        "players_in_room"
                    )
                    .select("status")
                    .eq(
                        "room_id",
                        roomId
                    )
                    .eq(
                        "user_id",
                        userId
                    )
                    .maybeSingle();

            if (voterError) {
                throw voterError;
            }

            if (
                !voter ||
                voter.status !==
                "alive"
            ) {
                return res.status(403).json({
                    ok: false,
                    error:
                        "Only alive players can vote",
                });
            }

            const finalTarget =
                targetUserId ||
                "skip";

            if (
                finalTarget !==
                "skip"
            ) {
                const {
                    data: target,
                    error: targetError,
                } =
                    await supaAdmin
                        .from(
                            "players_in_room"
                        )
                        .select(
                            "status"
                        )
                        .eq(
                            "room_id",
                            roomId
                        )
                        .eq(
                            "user_id",
                            finalTarget
                        )
                        .maybeSingle();

                if (targetError) {
                    throw targetError;
                }

                if (
                    !target ||
                    target.status !==
                    "alive"
                ) {
                    return res.status(400).json({
                        ok: false,
                        error:
                            "Target must be an alive player in this room",
                    });
                }
            }

            const votesForRoom =
                roomVotes.get(
                    roomId
                ) ||
                new Map<
                    string,
                    string
                >();

            votesForRoom.set(
                userId,
                finalTarget
            );

            roomVotes.set(
                roomId,
                votesForRoom
            );

            const tally: Record<
                string,
                number
            > = {};

            for (const t of votesForRoom.values()) {
                tally[t] =
                    (tally[t] || 0) +
                    1;
            }

            io.to(roomId).emit(
                "vote-updated",
                { tally }
            );

            return res.json({
                ok: true,
            });
        } catch (error) {
            console.error(
                "VOTE ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "Failed to submit vote",
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

// ======================================================
// LIVEKIT TOKEN
// ======================================================
//
// Видає короткоживучий LiveKit access token лише тому,
// хто дійсно є учасником (гравцем або admin) цієї room.
// LiveKit-кімната = наша room.id, тому відео/аудіо ніколи
// не перетинаються між різними іграми.

app.post(
    "/rooms/:id/livekit-token",
    requireAuth,
    async (
        req: AuthenticatedRequest,
        res: Response
    ) => {
        try {
            if (
                !LIVEKIT_API_KEY ||
                !LIVEKIT_API_SECRET
            ) {
                return res.status(500).json({
                    ok: false,
                    error:
                        "LiveKit is not configured on the server",
                });
            }

            const roomId =
                req.params.id;

            const userId =
                req.user!.id;

            const {
                data: room,
                error: roomError,
            } =
                await supaAdmin
                    .from("rooms")
                    .select(
                        "id, admin_id"
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

            const isAdmin =
                room.admin_id ===
                userId;

            let isMember = isAdmin;

            if (!isMember) {
                const {
                    data: membership,
                    error:
                        membershipError,
                } =
                    await supaAdmin
                        .from(
                            "players_in_room"
                        )
                        .select("id")
                        .eq(
                            "room_id",
                            roomId
                        )
                        .eq(
                            "user_id",
                            userId
                        )
                        .maybeSingle();

                if (membershipError) {
                    throw membershipError;
                }

                isMember =
                    !!membership;
            }

            if (!isMember) {
                return res.status(403).json({
                    ok: false,
                    error:
                        "Not a member of this room",
                });
            }

            const accessToken =
                new AccessToken(
                    LIVEKIT_API_KEY,
                    LIVEKIT_API_SECRET,
                    {
                        identity: userId,
                    }
                );

            accessToken.addGrant({
                room: roomId,
                roomJoin: true,
                canPublish: true,
                canSubscribe: true,
                canPublishData: true,
            });

            const token =
                await accessToken.toJwt();

            return res.json({
                ok: true,
                token,
            });
        } catch (error) {
            console.error(
                "LIVEKIT TOKEN ERROR:",
                error
            );

            return res.status(500).json({
                ok: false,
                error:
                    "Failed to create LiveKit token",
            });
        }
    }
);

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

            const requesterId =
                req.user!.id;

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

            // ==========================================
            // Тільки учасник цієї room (гравець або
            // admin) може бачити її ростер.
            // ==========================================

            const isAdmin =
                room.admin_id ===
                requesterId;

            let isMember = isAdmin;

            if (!isMember) {
                const {
                    data: membership,
                    error:
                        membershipError,
                } =
                    await supaAdmin
                        .from(
                            "players_in_room"
                        )
                        .select("id")
                        .eq(
                            "room_id",
                            roomId
                        )
                        .eq(
                            "user_id",
                            requesterId
                        )
                        .maybeSingle();

                if (membershipError) {
                    throw membershipError;
                }

                isMember =
                    !!membership;
            }

            if (!isMember) {
                return res.status(403).json({
                    ok: false,
                    error:
                        "Not a member of this room",
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

                        // Роль показуємо самому
                        // гравцю або admin room —
                        // усім іншим null, навіть якщо
                        // роль вже призначена в БД.
                        role:
                            player.user_id ===
                            requesterId ||
                            isAdmin
                                ? player.role
                                : null,

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

    "your-role": (
        data: {
            role:
                | "mafia"
                | "boss"
                | "detective"
                | "doctor"
                | "lover"
                | "civilian";
        }
    ) => void;

    "phase-changed": (
        data: {
            phase: string;
            phaseIndex: number;
            phaseStartedAt: string;
            phaseEndsAt:
                string | null;
        }
    ) => void;

    "night-action-result": (
        data: {
            type: string;
            targetUserId: string;
            result: boolean;
        }
    ) => void;

    "player-died": (
        data: {
            userId: string;
            role: string | null;
        }
    ) => void;

    "vote-updated": (
        data: {
            tally: Record<
                string,
                number
            >;
        }
    ) => void;

    "voting-finished": (
        data: {
            eliminatedUserId:
                string | null;
            role: string | null;
        }
    ) => void;

    "game-over": (
        data: {
            winner:
                | "mafia"
                | "civilians";
        }
    ) => void;
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

                    // Персональна кімната — щоб мати
                    // змогу приватно надіслати цьому
                    // юзеру подію на кшталт "your-role",
                    // незалежно від того, скільки в нього
                    // відкрито вкладок/сокетів.
                    socket.join(
                        `user:${userId}`
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