export interface PhaseConfig {
    key: string;
    name: string;
    duration?: number; // секунди; відсутнє = без автотаймера
    hasTimer: boolean;
}

/**
 * Той самий список фаз, що й на фронтенді
 * (client/src/game/phases.ts) — навмисно
 * продубльований тут, бо backend має бути єдиним
 * джерелом істини щодо поточної фази/таймера.
 *
 * hasTimer: false означає, що фаза не завершується
 * сама по собі — тільки коли admin натисне
 * "Наступна фаза" (POST /rooms/:id/next-phase).
 *
 * NB: тривалість "voting" тут навмисно змінена з 5с
 * (як було у старому client-only phases.ts — схоже на
 * баг/заглушку) на 60с, щоб голосування взагалі можна
 * було встигнути провести. Якщо 5с — свідоме рішення,
 * скажи, поверну.
 */
export const GAME_PHASES: PhaseConfig[] = [
    {
        key: 'role_distribution',
        name: 'Роздача ролей',
        hasTimer: false,
    },
    {
        key: 'introduction',
        name: 'Знайомство',
        duration: 60,
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
        hasTimer: false,
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
        duration: 60,
        hasTimer: true,
    },
    {
        key: 'end',
        name: 'Кінець гри',
        hasTimer: false,
    },
];
