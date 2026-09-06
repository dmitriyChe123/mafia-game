interface LocalCameraProps {
    localStream: MediaStream | null;
    currentPlayerIsDead: boolean;
}

export function LocalCamera({
                                localStream,
                                currentPlayerIsDead,
                            }: LocalCameraProps) {
    return (
        <div className="mt-5">
            <div className="mb-2 text-xs uppercase tracking-wider text-gray-500">
                Ваша камера
            </div>

            <div className="relative aspect-video overflow-hidden rounded-xl border border-gray-700 bg-black">
                {currentPlayerIsDead ? (
                    <div className="flex h-full flex-col items-center justify-center grayscale">
                        <div className="text-4xl">
                            ☠
                        </div>

                        <div className="mt-1 text-xl font-black tracking-widest text-red-700">
                            DEAD
                        </div>

                        <div className="mt-1 text-xs text-gray-600">
                            MIC OFF
                        </div>
                    </div>
                ) : localStream ? (
                    <video
                        ref={(element) => {
                            if (
                                element &&
                                localStream
                            ) {
                                element.srcObject =
                                    localStream;
                            }
                        }}
                        autoPlay
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                    />
                ) : (
                    <div className="flex h-full items-center justify-center text-sm text-gray-600">
                        Підключення камери...
                    </div>
                )}
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs">
                <span
                    className={`h-2 w-2 rounded-full ${
                        localStream
                            ? 'bg-green-500'
                            : 'bg-red-500'
                    }`}
                />

                {localStream
                    ? 'Камера підключена'
                    : 'Камера не підключена'}
            </div>
        </div>
    );
}