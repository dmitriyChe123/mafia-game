export interface PhaseConfig {
    key: string;
    name: string;
    duration?: number; // у секундах (опціонально)
    hasTimer?: boolean;
}

export const GAME_PHASES: PhaseConfig[] = [
    {
        key: 'role_distribution',
        name: 'Роздача ролей',
        hasTimer: false,
    },
    {
        key: 'introduction',
        name: 'Знайомство',
        duration: 60, // 1 хвилина на гравця, згодом зробимо множення
        hasTimer: true,
    },
    {
        key: 'night',
        name: 'Ніч',
        hasTimer: false,
    },
    {
        key: 'morning',
        name: 'Ранок (слово адміна)',
        hasTimer: false,
    },
    {
        key: 'chaos',
        name: 'Балаган',
        duration: 60,
        hasTimer: true,
    },
    {
        key: 'discussion',
        name: 'Думки гравців',
        hasTimer: true, // адмін вручну керує, згодом обробимо це
    },
    {
        key: 'defense',
        name: 'Виправдання',
        duration: 60,
        hasTimer: true,
    },
    {
        key: 'voting',
        name: 'Голосування',
        duration: 5,
        hasTimer: true,
    },
    {
        key: 'end',
        name: 'Кінець гри',
        hasTimer: false,
    },
];
