import { useEffect, useState } from 'react';

import { Player, Role } from '../../types';

type NightActionType =
    | 'mafia_kill'
    | 'detective_inspect'
    | 'doctor_heal'
    | 'lover_action';

const ROLE_NIGHT_ACTION: Partial<
    Record<Role, NightActionType>
> = {
    mafia: 'mafia_kill',
    boss: 'mafia_kill',
    detective: 'detective_inspect',
    doctor: 'doctor_heal',
    lover: 'lover_action',
};

const NIGHT_ACTION_LABEL: Record<
    NightActionType,
    string
> = {
    mafia_kill: '🔪 Обрати ціль для вбивства',
    detective_inspect:
        '🔍 Перевірити гравця',
    doctor_heal: '💉 Вилікувати гравця',
    lover_action: '❤️ Обрати гравця',
};

interface ActionPanelProps {
    phase: string;
    myRole: Role | undefined;
    myUserId: string | null;
    isDead: boolean;
    players: Player[];
    voteTally: Record<string, number>;
    nightActionResult: {
        type: string;
        targetUserId: string;
        result: boolean;
    } | null;
    winner: 'mafia' | 'civilians' | null;
    onNightAction: (
        type: NightActionType,
        targetUserId: string
    ) => Promise<{ ok: boolean }>;
    onVote: (
        targetUserId: string | 'skip'
    ) => Promise<{ ok: boolean }>;
}

export function ActionPanel({
                                 phase,
                                 myRole,
                                 myUserId,
                                 isDead,
                                 players,
                                 voteTally,
                                 nightActionResult,
                                 winner,
                                 onNightAction,
                                 onVote,
                             }: ActionPanelProps) {
    const [
        nightSubmitted,
        setNightSubmitted,
    ] = useState(false);

    const [
        votedFor,
        setVotedFor,
    ] = useState<string | null>(null);

    // Скидаємо стан "вже проголосував/подіяв"
    // при переході на нову фазу.
    useEffect(() => {
        setNightSubmitted(false);
        setVotedFor(null);
    }, [phase]);

    if (isDead) {
        return (
            <div className="mb-6 rounded-lg border border-gray-800 bg-gray-950 p-3 text-center text-sm text-gray-500">
                ☠ Ви вибули з гри й не можете
                діяти.
            </div>
        );
    }

    if (winner) {
        return (
            <div className="mb-6 rounded-lg border border-yellow-700 bg-yellow-950/40 p-4 text-center">
                <div className="text-xs uppercase tracking-wider text-yellow-500">
                    Гру завершено
                </div>

                <div className="mt-1 text-lg font-bold text-yellow-300">
                    {winner === 'mafia'
                        ? '🔪 Перемогла мафія'
                        : '🕊 Перемогли мирні'}
                </div>
            </div>
        );
    }

    const alivePlayers = players.filter(
        (p) =>
            p.alive &&
            p.id !== myUserId
    );

    // ==================================================
    // NIGHT
    // ==================================================

    if (phase === 'night') {
        const actionType = myRole
            ? ROLE_NIGHT_ACTION[myRole]
            : undefined;

        if (!actionType) {
            return (
                <div className="mb-6 rounded-lg border border-gray-800 bg-gray-950 p-3 text-center text-sm text-gray-500">
                    🌙 Ніч. У вашої ролі немає
                    нічної дії — зачекайте.
                </div>
            );
        }

        if (nightSubmitted) {
            return (
                <div className="mb-6 rounded-lg border border-green-800 bg-green-950/40 p-3 text-center text-sm text-green-400">
                    ✅ Дію передано. Чекайте на
                    ранок.
                </div>
            );
        }

        return (
            <div className="mb-6 rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="mb-2 text-sm font-semibold text-gray-300">
                    {
                        NIGHT_ACTION_LABEL[
                            actionType
                            ]
                    }
                </div>

                <div className="flex flex-col gap-1">
                    {alivePlayers.map(
                        (player) => (
                            <button
                                key={
                                    player.id
                                }
                                onClick={async () => {
                                    const res =
                                        await onNightAction(
                                            actionType,
                                            player.id
                                        );

                                    if (
                                        res.ok
                                    ) {
                                        setNightSubmitted(
                                            true
                                        );
                                    }
                                }}
                                className="rounded border border-gray-700 bg-gray-800 px-3 py-2 text-left text-sm text-gray-200 transition hover:border-red-600 hover:bg-red-900/30"
                            >
                                {player.name}
                            </button>
                        )
                    )}
                </div>

                {nightActionResult &&
                nightActionResult.type ===
                'detective_inspect' ? (
                    <div className="mt-3 rounded border border-blue-800 bg-blue-950/40 p-2 text-xs text-blue-300">
                        Результат перевірки:{' '}
                        {
                            players.find(
                                (p) =>
                                    p.id ===
                                    nightActionResult.targetUserId
                            )?.name
                        }{' '}
                        —{' '}
                        {nightActionResult.result
                            ? 'МАФІЯ 🔪'
                            : 'не мафія ✅'}
                    </div>
                ) : null}
            </div>
        );
    }

    // ==================================================
    // VOTING
    // ==================================================

    if (phase === 'voting') {
        if (votedFor) {
            return (
                <div className="mb-6 rounded-lg border border-green-800 bg-green-950/40 p-3 text-center text-sm text-green-400">
                    ✅ Голос враховано.
                </div>
            );
        }

        return (
            <div className="mb-6 rounded-lg border border-gray-800 bg-gray-950 p-3">
                <div className="mb-2 text-sm font-semibold text-gray-300">
                    🗳 Голосуйте за виключення
                </div>

                <div className="flex flex-col gap-1">
                    {alivePlayers.map(
                        (player) => (
                            <button
                                key={
                                    player.id
                                }
                                onClick={async () => {
                                    const res =
                                        await onVote(
                                            player.id
                                        );

                                    if (
                                        res.ok
                                    ) {
                                        setVotedFor(
                                            player.id
                                        );
                                    }
                                }}
                                className="flex items-center justify-between rounded border border-gray-700 bg-gray-800 px-3 py-2 text-left text-sm text-gray-200 transition hover:border-yellow-600 hover:bg-yellow-900/20"
                            >
                                <span>
                                    {
                                        player.name
                                    }
                                </span>

                                {voteTally[
                                    player.id
                                    ] ? (
                                    <span className="text-xs text-yellow-400">
                                            {
                                                voteTally[
                                                    player.id
                                                    ]
                                            }{' '}
                                        голос(ів)
                                        </span>
                                ) : null}
                            </button>
                        )
                    )}

                    <button
                        onClick={async () => {
                            const res =
                                await onVote(
                                    'skip'
                                );

                            if (res.ok) {
                                setVotedFor(
                                    'skip'
                                );
                            }
                        }}
                        className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-left text-sm text-gray-500 transition hover:border-gray-500"
                    >
                        Утриматись
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
