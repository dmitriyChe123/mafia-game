export type RoomSize = 'small' | 'large';

/**
 * Цільова кількість ІГРОВИХ гравців (без admin) за ТЗ:
 *   small -> 8
 *   large -> 11
 *
 * Backend сам вирішує ці числа — frontend НЕ передає
 * maxPlayers, лише бажаний room_size.
 */
export const ROOM_SIZE_TARGETS: Record<
    RoomSize,
    number
> = {
    small: 8,
    large: 11,
};

export function normalizeRoomSize(
    value: unknown
): RoomSize {
    return value === 'large'
        ? 'large'
        : 'small';
}
