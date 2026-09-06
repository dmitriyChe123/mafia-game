import { Player } from '../../types';

interface PlayerListProps {
    players: Player[];
    adminId?: string;
    currentUserId: string | null;
    disconnectedPlayerIds: string[];
}

export function PlayerList({
                               players,
                               adminId,
                               currentUserId,
                               disconnectedPlayerIds,
                           }: PlayerListProps) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-red-400">
                    Гравці
                </h3>

                <span className="text-xs text-gray-500">
                    {players.length}
                </span>
            </div>

            <ul className="space-y-2 text-sm">
                {players.map((player) => {
                    const isDisconnected =
                        disconnectedPlayerIds.includes(
                            player.id
                        );

                    return (
                        <li
                            key={player.id}
                            className={`
                                flex items-center justify-between rounded-lg px-2 py-1 transition-colors
                                ${
                                isDisconnected
                                    ? 'bg-yellow-900/20 text-gray-500'
                                    : 'hover:bg-gray-800'
                            }
                            `}
                        >
                            <span>
                                {player.id ===
                                adminId ? (
                                    <span className="mr-1">
                                        👑
                                    </span>
                                ) : (
                                    <span className="mr-1 text-gray-500">
                                        #
                                        {
                                            player.number
                                        }
                                    </span>
                                )}

                                {player.name}

                                {player.id ===
                                currentUserId ? (
                                    <span className="ml-1 text-[10px] text-blue-400">
                                        YOU
                                    </span>
                                ) : null}

                                {isDisconnected ? (
                                    <span className="ml-2 text-[10px] font-bold uppercase text-yellow-600">
                                        OFFLINE
                                    </span>
                                ) : null}
                            </span>

                            <span>
                                {isDisconnected
                                    ? '📡'
                                    : player.alive
                                        ? '🙂'
                                        : '💀'}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}