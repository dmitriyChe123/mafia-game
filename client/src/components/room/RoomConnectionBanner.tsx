import { Player } from '../../types';

interface RoomConnectionBannerProps {
    connectionPaused: boolean;
    disconnectedPlayers: Player[];
    isAdmin: boolean;
    onDecision: (
        decision: 'wait' | 'continue'
    ) => void;
}

export function RoomConnectionBanner({
                                         connectionPaused,
                                         disconnectedPlayers,
                                         isAdmin,
                                         onDecision,
                                     }: RoomConnectionBannerProps) {
    if (
        !connectionPaused ||
        disconnectedPlayers.length === 0
    ) {
        return null;
    }

    return (
        <div className="fixed inset-x-0 top-0 z-[100] border-b border-yellow-700 bg-gray-950/95 px-6 py-4 shadow-2xl backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-6">
                <div>
                    <div className="font-black tracking-wider text-yellow-400">
                        ⏸ ГРА ПРИЗУПИНЕНА
                    </div>

                    <div className="mt-1 text-sm text-gray-300">
                        {disconnectedPlayers.length ===
                        1
                            ? `Гравець "${disconnectedPlayers[0]?.name || 'Player'}" втратив з'єднання.`
                            : `Втрачено з'єднання з ${disconnectedPlayers.length} гравцями.`}
                    </div>

                    <div className="mt-1 text-xs text-gray-500">
                        Гра очікує рішення адміністратора.
                    </div>
                </div>

                {isAdmin ? (
                    <div className="flex gap-3">
                        <button
                            onClick={() =>
                                onDecision('wait')
                            }
                            className="rounded-lg bg-yellow-600 px-5 py-2 font-bold text-black transition hover:bg-yellow-500"
                        >
                            ⏳ ЖДЁМ
                        </button>

                        <button
                            onClick={() =>
                                onDecision(
                                    'continue'
                                )
                            }
                            className="rounded-lg bg-green-700 px-5 py-2 font-bold text-white transition hover:bg-green-600"
                        >
                            ▶ НЕ ЖДЁМ
                        </button>
                    </div>
                ) : (
                    <div className="text-sm text-gray-400">
                        Очікуємо рішення адміністратора...
                    </div>
                )}
            </div>
        </div>
    );
}