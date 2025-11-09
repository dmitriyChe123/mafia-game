import { GamePhase, RoomState, Player, Role } from '../types';
import { GAME_PHASES, PhaseConfig } from './phases';

// 🔹 Поточна фаза
export const getCurrentPhase = (room: RoomState) => {
    return GAME_PHASES[room.currentPhaseIndex];
};

// 🔹 Перемішування
const shuffle = <T,>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

// 🔹 Призначення ролей
const assignRoles = (players: Player[]): Player[] => {
    const baseRoles: Role[] = ['mafia', 'boss', 'detective', 'doctor', 'lover'];
    const civiliansCount = Math.max(players.length - baseRoles.length, 0);
    const allRoles = [...baseRoles, ...Array(civiliansCount).fill('civilian')];
    const shuffledRoles = shuffle(allRoles);

    return players.map((p, i) => ({
        ...p,
        role: shuffledRoles[i],
    }));
};

// 🔹 Старт гри — роздає ролі і переходить у фазу role_distribution
export const startGame = (room: RoomState): RoomState => {
    const updatedPlayers = assignRoles(room.players);

    const updatedRoom: RoomState = {
        ...room,
        players: updatedPlayers,
        phase: 'role_distribution' as GamePhase,
        currentPhaseIndex: 0,
    };

    localStorage.setItem(`room_${updatedRoom.id}`, JSON.stringify(updatedRoom));
    return updatedRoom;
};

// 🔹 Перехід до наступної фази
export const nextPhase = (room: RoomState): RoomState => {
    const nextIndex = room.currentPhaseIndex + 1;

    if (nextIndex >= GAME_PHASES.length) {
        const resetPlayers: Player[] = shuffle(
            room.players.map(p => ({
                ...p,
                alive: true,
                protected: false,
                alibi: false,
                checkedByBoss: false,
                role: undefined,
            }))
        );

        const restartedRoom: RoomState = {
            ...room,
            players: resetPlayers,
            phase: 'role_distribution' as GamePhase,
            currentPhaseIndex: 0,
        };

        localStorage.setItem(`room_${restartedRoom.id}`, JSON.stringify(restartedRoom));
        return restartedRoom;
    }

    const nextPhase: PhaseConfig = GAME_PHASES[nextIndex];
    const updatedRoom: RoomState = {
        ...room,
        phase: nextPhase.key as GamePhase,
        currentPhaseIndex: nextIndex,
    };

    localStorage.setItem(`room_${updatedRoom.id}`, JSON.stringify(updatedRoom));
    return updatedRoom;
};
