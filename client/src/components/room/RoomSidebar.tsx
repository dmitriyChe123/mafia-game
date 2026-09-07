import { Player, RoomState } from '../../types';
import { getCurrentPhase } from '../../game/phaseManager';
import { AdminControls } from './AdminControls';
import { LocalCamera } from './LocalCamera';
import { PlayerList } from './PlayerList';

interface RoomSidebarProps {
    room: RoomState;
    playerName: string;
    currentUserId: string | null;
    currentPlayerIsDead: boolean;
    disconnectedPlayerIds: string[];
    localStream: MediaStream | null;
    mediaError: string | null;
    timer: number | null;
    isPaused: boolean;
    isAdmin: boolean;
    handleLogout: () => void;
    handleCopyId: () => void;
    setIsPaused: React.Dispatch<
        React.SetStateAction<boolean>
    >;
    handleRepeatPhase: () => void;
    handleStart: () => void;
    handleNextPhase: () => void;
}

export function RoomSidebar({
                                room,
                                playerName,
                                currentUserId,
                                currentPlayerIsDead,
                                disconnectedPlayerIds,
                                localStream,
                                mediaError,
                                timer,
                                isPaused,
                                isAdmin,
                                handleLogout,
                                handleCopyId,
                                setIsPaused,
                                handleRepeatPhase,
                                handleStart,
                                handleNextPhase,
                            }: RoomSidebarProps) {
    return (
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-gray-800 bg-gray-900 p-5">
            <div>
                <div className="mb-5">
                    <button
                        onClick={handleLogout}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 text-sm text-gray-300 transition hover:border-red-700 hover:bg-red-900/30 hover:text-white"
                    >
                        🚪 Вийти з акаунта
                    </button>
                </div>

                <div className="mb-6">
                    <div className="mb-1 text-xs uppercase tracking-wider text-gray-500">
                        Room ID
                    </div>

                    <div className="flex items-center gap-2 break-all text-sm font-semibold text-red-400">
                        <span>{room.id}</span>

                        <button
                            onClick={handleCopyId}
                            className="shrink-0 text-gray-400 hover:text-white"
                        >
                            📋
                        </button>
                    </div>
                </div>

                <div className="mb-6">
                    {isAdmin ? (
                        <div className="font-semibold text-yellow-400">
                            👑 Ви адміністратор
                        </div>
                    ) : (
                        <div className="font-semibold text-gray-400">
                            Ви гравець
                        </div>
                    )}
                </div>

                <div className="mb-6">
                    <div className="text-xs uppercase tracking-wider text-gray-500">
                        Поточна фаза
                    </div>

                    <div className="mt-1 text-lg font-bold text-yellow-300">
                        {
                            getCurrentPhase(
                                room
                            )?.name
                        }
                    </div>

                    {timer !== null ? (
                        <div
                            className={`mt-2 text-xl font-bold ${
                                isPaused
                                    ? 'text-yellow-400'
                                    : 'text-green-400'
                            }`}
                        >
                            {isPaused
                                ? '⏸'
                                : '⏱'}{' '}
                            {timer}s
                        </div>
                    ) : null}
                </div>

                <div className="mb-6">
                    <div className="text-xs uppercase tracking-wider text-gray-500">
                        Ви увійшли як
                    </div>

                    <div className="mt-1 font-semibold">
                        {playerName}
                    </div>

                    {currentPlayerIsDead ? (
                        <div className="mt-1 text-xs font-bold text-red-500">
                            ☠ DEAD — мікрофон вимкнено
                        </div>
                    ) : null}
                </div>

                <PlayerList
                    players={room.players}
                    adminId={room.adminId}
                    currentUserId={currentUserId}
                    disconnectedPlayerIds={
                        disconnectedPlayerIds
                    }
                />
            </div>

            {isAdmin ? (
                <AdminControls
                    isPaused={isPaused}
                    roomPhase={room.phase}
                    onPause={() =>
                        setIsPaused(
                            (value) => !value
                        )
                    }
                    onRepeatPhase={
                        handleRepeatPhase
                    }
                    onStart={handleStart}
                    onNextPhase={
                        handleNextPhase
                    }
                />
            ) : null}

            <LocalCamera
                localStream={localStream}
                mediaError={mediaError}
                currentPlayerIsDead={
                    currentPlayerIsDead
                }
            />
        </aside>
    );
}