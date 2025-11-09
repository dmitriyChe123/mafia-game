export type Role =
    | 'mafia'
    | 'boss'
    | 'detective'
    | 'doctor'
    | 'lover' // путана
    | 'civilian';

export type GamePhase =
    | 'lobby'           // до старту
    | 'idle'           // до старту
    | 'role_distribution'
    | 'introduction'
    | 'night'
    | 'morning'
    | 'chaos'
    | 'discussion'
    | 'defense'
    | 'voting'
    | 'end';

export interface Player {
    id: string;
    name: string;
    alive: boolean;
    role?: Role;

    // 💊 лікар та 💋 путана — службові прапорці
    protected?: boolean; // якщо врятований лікарем
    checkedByBoss?: boolean; // якщо бос перевірив
    alibi?: boolean; // якщо отримав алібі від путани

    // 📜 історія дій (для перевірки обмежень)
    lastTargetId?: string; // кого вибрав минулого разу
    selfHealCount?: number; // скільки разів рятував себе
    selfLoveCount?: number; // скільки разів “проводив час” сам із собою 😄
}

export interface RoomState {
    id: string;
    players: Player[];
    phase: GamePhase;
    currentPhaseIndex: number;
    adminId?: string;
}
