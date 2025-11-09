import { Player, Role } from '../types';

export function generateRoles(playerCount: number): Role[] {
    const roles: Role[] = [];

    // 🕵️ Активні ролі, якщо гравців достатньо
    const hasDetective = playerCount >= 5;
    const hasDoctor = playerCount >= 6;
    const hasLover = playerCount >= 7;

    // 🧮 Визначаємо кількість мафій за пропорцією (√N або ~25%)
    const mafiaCount = Math.max(1, Math.floor(Math.sqrt(playerCount) / 1.5));
    const bossCount = 1; // завжди є бос мафії

    // 🎭 Додаємо мафію
    for (let i = 0; i < mafiaCount; i++) roles.push('mafia');
    roles.push('boss'); // бос мафії

    // 👮 Активні ролі (якщо вистачає місць)
    if (hasDetective) roles.push('detective');
    if (hasDoctor) roles.push('doctor');
    if (hasLover) roles.push('lover');

    // 👤 Решта — цивільні
    while (roles.length < playerCount) {
        roles.push('civilian');
    }

    // 🎲 Перемішуємо ролі випадковим чином
    return roles.sort(() => Math.random() - 0.5);
}

/**
 * Призначає ролі всім гравцям у кімнаті
 */
export function assignRolesToPlayers(players: Player[]): Player[] {
    const roles = generateRoles(players.length);

    // 🎲 Перемішуємо гравців перед роздачею ролей
    const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);

    // 🧩 Призначаємо ролі кожному гравцю
    const withRoles = shuffledPlayers.map((player, index) => ({
        ...player,
        role: roles[index],
    }));

    // 🧠 Перевірка в консолі (допоможе діагностувати, якщо ролі не відображаються)
    console.log('🎭 Роздані ролі:', withRoles.map(p => `${p.name} → ${p.role}`));

    return withRoles;
}