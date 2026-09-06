import { Player } from '../../types';
import { VideoTile } from './VideoTile';

interface RoomTableProps {
    players: Player[];
    currentUserId: string | null;
    isAdmin: boolean;
    isSmallRoom: boolean;
    loadingPlayers: boolean;
    getPlayerStream: (
        player: Player
    ) => MediaStream | null;
    handleMakeAdmin: (
        playerId: string
    ) => void;
    transferringAdminId: string | null;
    roomPhase: string;
    adminId?: string;
}

export function RoomTable({
                              players,
                              currentUserId,
                              adminId,
                              isAdmin,
                              isSmallRoom,
                              loadingPlayers,
                              getPlayerStream,
                              handleMakeAdmin,
                              transferringAdminId,
                              roomPhase,
                          }: RoomTableProps) {




    const roomAdmin = adminId
        ? players.find((player) => player.id === adminId)
        : undefined;

    const normalPlayers = roomAdmin
        ? players.filter(
            (player) => player.id !== roomAdmin.id
        )
        : players;

    // ==================================================
    // RESPONSIVE LAYOUT
    //
    // Кількість гравців у грі — від 8 (Small) до 11
    // (Large) + адмін окремо. Замість двох фіксованих
    // варіантів (3/4 колонки) підбираємо кількість
    // колонок під фактичну кількість "звичайних"
    // гравців, щоб сітка не розповзалась і не
    // виглядала добре лише для одного розміру кімнати.
    // ==================================================

    const columnsByCount = (count: number) => {
        if (count <= 2) return 2;
        if (count <= 4) return 2;
        if (count <= 6) return 3;
        if (count <= 9) return 3;
        return 4;
    };

    const gridColumns = columnsByCount(
        normalPlayers.length
    );

    if (loadingPlayers) {
        return (
            <main className="flex min-w-0 flex-1 items-center justify-center overflow-auto p-6">
                <div className="text-gray-500">
                    Завантаження гравців...
                </div>
            </main>
        );
    }

    if (players.length === 0) {
        return (
            <main className="flex min-w-0 flex-1 items-center justify-center overflow-auto p-6">
                <div className="text-gray-500">
                    У кімнаті поки немає гравців
                </div>
            </main>
        );
    }

    return (
        <main className="flex min-w-0 flex-1 items-center justify-center overflow-auto p-6">
            <div
                className="grid w-full max-w-5xl items-center justify-items-center gap-4"
                style={{
                    gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
                }}
            >
                {normalPlayers.map(
                    (player) => (
                        <VideoTile
                            key={player.id}
                            player={player}
                            isMe={
                                player.id ===
                                currentUserId
                            }
                            isAdmin={isAdmin}
                            isRoomAdmin={false}
                            stream={getPlayerStream(
                                player
                            )}
                            canTransferAdmin={
                                isAdmin &&
                                roomPhase ===
                                'lobby'
                            }
                            onMakeAdmin={
                                handleMakeAdmin
                            }
                            transferringAdmin={
                                transferringAdminId ===
                                player.id
                            }
                        />
                    )
                )}

                {roomAdmin ? (
                    <VideoTile
                        key={`admin-${roomAdmin.id}`}
                        player={roomAdmin}
                        isMe={
                            roomAdmin.id ===
                            currentUserId
                        }
                        isAdmin={isAdmin}
                        isRoomAdmin
                        stream={getPlayerStream(
                            roomAdmin
                        )}
                        large
                    />
                ) : null}
            </div>
        </main>
    );
}