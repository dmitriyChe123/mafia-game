interface AdminControlsProps {
    isPaused: boolean;
    roomPhase: string;
    onPause: () => void;
    onRepeatPhase: () => void;
    onStart: () => void;
    onNextPhase: () => void;
}

export function AdminControls({
                                  isPaused,
                                  roomPhase,
                                  onPause,
                                  onRepeatPhase,
                                  onStart,
                                  onNextPhase,
                              }: AdminControlsProps) {
    return (
        <div className="mt-6 flex flex-col gap-2">
            <button
                onClick={onPause}
                className="rounded bg-gray-700 py-2 hover:bg-gray-600"
            >
                {isPaused
                    ? '▶ Продовжити'
                    : '⏸ Пауза'}
            </button>

            <button
                onClick={onRepeatPhase}
                className="rounded bg-yellow-700 py-2 hover:bg-yellow-600"
            >
                🔁 Повтор фази
            </button>

            {roomPhase === 'lobby' ? (
                <button
                    onClick={onStart}
                    className="rounded bg-green-700 py-2 font-bold hover:bg-green-600"
                >
                    🚀 Старт гри
                </button>
            ) : (
                <button
                    onClick={onNextPhase}
                    className="rounded bg-purple-700 py-2 font-bold hover:bg-purple-600"
                >
                    ⏭ Наступна фаза
                </button>
            )}
        </div>
    );
}