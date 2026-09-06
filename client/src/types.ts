export type Role =
    | 'mafia'
    | 'boss'
    | 'detective'
    | 'doctor'
    | 'lover'
    | 'civilian';

export type GamePhase =
    | 'lobby'
    | 'idle'
    | 'role_distribution'
    | 'introduction'
    | 'night'
    | 'morning'
    | 'chaos'
    | 'discussion'
    | 'defense'
    | 'voting'
    | 'end';

export type RoomType =
    | 'public'
    | 'private';

export type RoomSize =
    | 'small'
    | 'large';

export type RoomStatus =
    | 'waiting'
    | 'playing'
    | 'finished';

export interface Player {
    id: string;
    name: string;
    alive: boolean;
    role?: Role;

    /**
     * Порядковый номер обычного игрока.
     *
     * Админ его НЕ имеет.
     */
    number?: number;

    // Doctor / Lover
    protected?: boolean;
    checkedByBoss?: boolean;
    alibi?: boolean;

    // Action history
    lastTargetId?: string;
    selfHealCount?: number;
    selfLoveCount?: number;
}

export interface BackendRoom {
    id: string;
    name: string;
    created_by: string;
    admin_id: string;
    room_type: RoomType;
    room_size: RoomSize;
    status: RoomStatus;
    created_at: string;
    updated_at: string;
}

export interface RoomPlayer {
    id: string;
    room_id: string;
    user_id: string;
    role: Role | null;
    status: 'alive' | 'dead';
    joined_at: string;

    users: {
        id: string;
        name: string;
        email: string;
        avatar_url: string | null;
        wins: number;
        losses: number;
        games_played: number;
        is_premium: boolean;
        premium_extra_time: number;
        premium_profile_mod: boolean;
        premium_frame_avatar: boolean;
        premium_frame_camera: boolean;
        created_at: string;
    } | null;
}

export interface RoomState {
    id: string;
    players: Player[];
    phase: GamePhase;
    currentPhaseIndex: number;
    adminId?: string;
}