import { useEffect, useRef } from 'react';
import { Player } from '../../types';

interface VideoTileProps {
    player: Player;
    isMe: boolean;
    isAdmin: boolean;
    isRoomAdmin: boolean;
    stream: MediaStream | null;
    large?: boolean;
    canTransferAdmin?: boolean;
    onMakeAdmin?: (playerId: string) => void;
    transferringAdmin?: boolean;
}

export function VideoTile({
                              player,
                              isMe,
                              isAdmin,
                              isRoomAdmin,
                              stream,
                              large = false,
                              canTransferAdmin = false,
                              onMakeAdmin,
                              transferringAdmin = false,
                          }: VideoTileProps) {
    const videoRef =
        useRef<HTMLVideoElement | null>(null);

    const isDead = !player.alive;

    useEffect(() => {
        const video = videoRef.current;

        if (!video) return;

        video.srcObject = stream || null;

        if (stream) {
            video.play().catch(() => {});
        }

        return () => {
            video.srcObject = null;
        };
    }, [stream]);

    return (
        <div
            className={`
                group relative overflow-hidden rounded-2xl border bg-gray-900 shadow-xl
                transition-all duration-500 ease-in-out hover:-translate-y-1
                ${
                large
                    ? 'h-56 w-56 border-yellow-500/70'
                    : 'h-44 w-44 border-gray-700'
            }
                ${isMe ? 'ring-2 ring-blue-500' : ''}
                ${isDead ? 'border-red-800' : ''}
            `}
        >
            {isDead ? (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black">
                    <div className="text-5xl grayscale">
                        ☠
                    </div>

                    <div className="mt-2 text-3xl font-black tracking-[0.25em] text-red-700">
                        DEAD
                    </div>

                    <div className="mt-2 text-xs uppercase tracking-widest text-gray-600">
                        Мікрофон вимкнено
                    </div>
                </div>
            ) : null}

            {!isDead && stream ? (
                <video
                    ref={videoRef}
                    autoPlay
                    muted={isMe}
                    playsInline
                    className="absolute inset-0 h-full w-full object-cover"
                />
            ) : (
                !isDead && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800">
                        <div
                            className={`
                                flex items-center justify-center rounded-xl bg-gray-700
                                ${
                                large
                                    ? 'h-32 w-48'
                                    : 'h-24 w-36'
                            }
                            `}
                        >
                            <span className="text-sm text-gray-500">
                                Camera
                            </span>
                        </div>
                    </div>
                )
            )}

            {!isDead && stream ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-black/80 to-transparent" />
            ) : null}

            {!isRoomAdmin && player.number ? (
                <div className="absolute left-2 top-2 z-20 flex h-7 min-w-7 items-center justify-center rounded-md bg-black/60 px-2 text-xs font-bold text-gray-200 backdrop-blur">
                    #{player.number}
                </div>
            ) : null}

            {isRoomAdmin ? (
                <div className="absolute right-2 top-2 z-20 rounded bg-yellow-500 px-2 py-1 text-xs font-bold text-black">
                    👑 ADMIN
                </div>
            ) : null}

            {!isDead && stream ? (
                <div className="absolute bottom-2 right-2 z-20 text-sm">
                    🎙️
                </div>
            ) : null}

            <div className="absolute bottom-2 left-3 z-20">
                <div className="text-sm font-bold text-white">
                    {player.name}
                </div>

                {isMe ? (
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                        YOU
                    </div>
                ) : null}

                {isAdmin && player.role ? (
                    <div className="text-[10px] text-yellow-400">
                        {player.role}
                    </div>
                ) : null}
            </div>

            {canTransferAdmin &&
            !isRoomAdmin &&
            !isMe &&
            onMakeAdmin ? (
                <button
                    onClick={() =>
                        onMakeAdmin(player.id)
                    }
                    disabled={transferringAdmin}
                    className="absolute bottom-2 right-2 z-40 rounded-lg bg-yellow-500/90 px-2 py-1 text-[10px] font-bold text-black opacity-0 shadow-lg transition-all duration-200 hover:bg-yellow-400 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {transferringAdmin
                        ? '...'
                        : '👑 ADMIN'}
                </button>
            ) : null}
        </div>
    );
}