import { FormEvent, useState } from 'react';
import { supabase } from '../supabase';

export default function Auth() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isRegister, setIsRegister] = useState(false);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        setLoading(true);
        setMessage('');

        if (isRegister) {
            if (!name.trim()) {
                setMessage('Введите имя');
                setLoading(false);
                return;
            }

            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        name: name.trim(),
                    },
                },
            });

            if (error) {
                setMessage(error.message);
            } else {
                setMessage(
                    'Регистрация успешна. Проверьте email для подтверждения.'
                );
            }
        } else {
            const { error } =
                await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

            if (error) {
                setMessage(error.message);
            }
        }

        setLoading(false);
    };

    const handleGoogleLogin = async () => {
        setMessage('');

        const { error } =
            await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: window.location.origin,
                },
            });

        if (error) {
            setMessage(error.message);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
            <div className="w-full max-w-md rounded-xl bg-gray-800 p-8 shadow-xl">
                <h1 className="mb-6 text-center text-3xl font-bold">
                    🎭 Mafia
                </h1>

                <h2 className="mb-6 text-center text-xl">
                    {isRegister
                        ? 'Регистрация'
                        : 'Вход'}
                </h2>

                <form
                    onSubmit={handleSubmit}
                    className="flex flex-col gap-4"
                >
                    <input
                        type="text"
                        placeholder="Имя"
                        value={name}
                        onChange={(e) =>
                            setName(e.target.value)
                        }
                        className="rounded p-3 text-black"
                        required
                    />
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) =>
                            setEmail(e.target.value)
                        }
                        className="rounded p-3 text-black"
                        required
                    />

                    <input
                        type="password"
                        placeholder="Пароль"
                        value={password}
                        onChange={(e) =>
                            setPassword(e.target.value)
                        }
                        className="rounded p-3 text-black"
                        minLength={6}
                        required
                    />

                    <button
                        type="submit"
                        disabled={loading}
                        className="rounded bg-blue-600 p-3 font-semibold hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading
                            ? 'Загрузка...'
                            : isRegister
                                ? 'Зарегистрироваться'
                                : 'Войти'}
                    </button>
                </form>

                <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gray-600" />

                    <span className="text-gray-400">
                        или
                    </span>

                    <div className="h-px flex-1 bg-gray-600" />
                </div>

                <button
                    onClick={handleGoogleLogin}
                    className="w-full rounded bg-white p-3 font-semibold text-black hover:bg-gray-200"
                >
                    Войти через Google
                </button>

                {message && (
                    <p className="mt-4 text-center text-sm text-gray-300">
                        {message}
                    </p>
                )}

                <button
                    onClick={() => {
                        setIsRegister(!isRegister);
                        setMessage('');
                    }}
                    className="mt-6 w-full text-sm text-blue-400 hover:text-blue-300"
                >
                    {isRegister
                        ? 'Уже есть аккаунт? Войти'
                        : 'Нет аккаунта? Зарегистрироваться'}
                </button>
            </div>
        </div>
    );
}