export type Role =
    | 'mafia'
    | 'boss'
    | 'detective'
    | 'doctor'
    | 'lover'
    | 'civilian';

/**
 * Композиція ролей за MAFIA_TZ_RELEASE_CHECKLIST_v1.0:
 *
 *   Small (8 гравців): 2 Mafia, 1 Sheriff(detective),
 *                       1 Doctor, 1 Lover, 3 Civilian
 *   Large (11 гравців): 1 Don(boss), 2 Mafia, 1 Sheriff,
 *                        1 Doctor, 1 Lover, 5 Civilian
 *
 * Для тестових кімнат з меншою кількістю гравців (поки
 * немає повного matchmaking на 8/11) склад пропорційно
 * спрощується, зберігаючи дух ТЗ: спочатку з'являється
 * мафія, потім detective/doctor/lover по мірі зростання
 * кількості гравців, решта — цивільні.
 */
export function assignRoles(
    playerCount: number
): Role[] {
    if (playerCount >= 11) {
        const roles: Role[] = [
            'boss',
            'mafia',
            'mafia',
            'detective',
            'doctor',
            'lover',
        ];

        while (roles.length < playerCount) {
            roles.push('civilian');
        }

        return shuffle(roles);
    }

    if (playerCount >= 8) {
        const roles: Role[] = [
            'mafia',
            'mafia',
            'detective',
            'doctor',
            'lover',
        ];

        while (roles.length < playerCount) {
            roles.push('civilian');
        }

        return shuffle(roles);
    }

    // ---- тестовий режим (< 8 гравців) ----

    const roles: Role[] = ['mafia'];

    if (playerCount >= 6) {
        roles.push('mafia');
    }

    if (playerCount >= 4) {
        roles.push('detective');
    }

    if (playerCount >= 5) {
        roles.push('doctor');
    }

    if (playerCount >= 7) {
        roles.push('lover');
    }

    while (roles.length < playerCount) {
        roles.push('civilian');
    }

    return shuffle(roles.slice(0, playerCount));
}

function shuffle<T>(items: T[]): T[] {
    const array = [...items];

    for (
        let i = array.length - 1;
        i > 0;
        i--
    ) {
        const j = Math.floor(
            Math.random() * (i + 1)
        );

        [array[i], array[j]] = [
            array[j],
            array[i],
        ];
    }

    return array;
}
