/**
 * Login Component - Password-based Vault Authentication
 * Register and login with username/password
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser, faLock, faUserPlus, faSignInAlt, faKey } from '@fortawesome/free-solid-svg-icons';

const Login = () => {
    const { login, register, loading, error, dbReady, checkUsername } = useAuth();
    
    const [isRegister, setIsRegister] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [localError, setLocalError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLocalError('');

        if (!username.trim() || !password) {
            setLocalError('Please fill in all fields');
            return;
        }

        if (isRegister) {
            if (password !== confirmPassword) {
                setLocalError('Passwords do not match');
                return;
            }
            if (password.length < 8) {
                setLocalError('Password must be at least 8 characters');
                return;
            }
            
            // checkUsername is now async
            const isAvailable = await checkUsername(username);
            if (!isAvailable) {
                setLocalError('Username already taken');
                return;
            }

            try {
                await register(username, password);
            } catch (err) {
                setLocalError(err.message);
            }
        } else {
            try {
                await login(username, password);
            } catch (err) {
                setLocalError(err.message);
            }
        }
    };

    const displayError = localError || error;

    return (
        <div className="h-screen flex items-center justify-center bg-cream dark:bg-navy text-primary p-4">
            <div className="max-w-md w-full bg-surface dark:bg-navyLight p-8 rounded-3xl shadow-xl border-2 border-primary/10">
                <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 text-3xl">
                    🧠
                </div>
                <h1 className="text-3xl font-bold mb-2 text-primary dark:text-white text-center">
                    {isRegister ? 'Create Account' : 'Welcome Back'}
                </h1>
                <p className="text-gray-500 mb-6 text-center">
                    {isRegister 
                        ? 'Set up your encrypted vault' 
                        : 'Enter your credentials to unlock'}
                </p>

                {displayError && (
                    <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm text-center">
                        {displayError}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="relative">
                        <FontAwesomeIcon 
                            icon={faUser} 
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                            type="text"
                            placeholder="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value.toLowerCase())}
                            className="w-full pl-12 pr-4 py-4 bg-white dark:bg-navy border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:border-primary focus:outline-none transition-colors"
                            disabled={loading || !dbReady}
                        />
                    </div>

                    <div className="relative">
                        <FontAwesomeIcon 
                            icon={faLock} 
                            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                        />
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full pl-12 pr-4 py-4 bg-white dark:bg-navy border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:border-primary focus:outline-none transition-colors"
                            disabled={loading || !dbReady}
                        />
                    </div>

                    {isRegister && (
                        <div className="relative">
                            <FontAwesomeIcon 
                                icon={faKey} 
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                            />
                            <input
                                type="password"
                                placeholder="Confirm Password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full pl-12 pr-4 py-4 bg-white dark:bg-navy border-2 border-gray-200 dark:border-gray-700 rounded-xl focus:border-primary focus:outline-none transition-colors"
                                disabled={loading || !dbReady}
                            />
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !dbReady}
                        className="w-full flex items-center justify-center gap-3 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <>
                                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span>{isRegister ? 'Creating Vault...' : 'Unlocking...'}</span>
                            </>
                        ) : (
                            <>
                                <FontAwesomeIcon icon={isRegister ? faUserPlus : faSignInAlt} />
                                <span>{isRegister ? 'Create Account' : 'Sign In'}</span>
                            </>
                        )}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <button
                        onClick={() => {
                            setIsRegister(!isRegister);
                            setLocalError('');
                        }}
                        className="text-purple-600 hover:text-purple-700 font-medium transition-colors"
                    >
                        {isRegister 
                            ? 'Already have an account? Sign In' 
                            : "Don't have an account? Create one"}
                    </button>
                </div>

                <p className="mt-6 text-xs text-gray-400 text-center">
                    🔒 Your password encrypts your Nostr key locally. We never see it.
                </p>
            </div>
        </div>
    );
};

export default Login;
