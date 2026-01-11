/**
 * Focus Banner Component
 * Shows current focus task and countdown timer
 */

import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPause, faCheck, faExchangeAlt } from '@fortawesome/free-solid-svg-icons';
import { useAppContext } from '../context/AppContext';
import { query, onDBChange, isDatabaseReady } from '../db/index.js';

const FocusBanner = ({ task, onStop, onComplete, onSwitch }) => {
    const { settings } = useAppContext();
    const [timeLeft, setTimeLeft] = useState(settings.focusDuration * 60);
    const [status, setStatus] = useState('running');
    
    // Get the latest focus session for the current task
    const getLatestSession = useCallback(() => {
        if (!task || !isDatabaseReady()) return null;
        
        try {
            const sessions = query(`
                SELECT * FROM focus_sessions 
                WHERE task_id = ? 
                ORDER BY started_at DESC 
                LIMIT 1
            `, [task.id]);
            
            return sessions[0] || null;
        } catch {
            return null;
        }
    }, [task?.id]);

    useEffect(() => {
        if (!task) return;
        
        const session = getLatestSession();

        if (session) {
            const start = new Date(session.started_at).getTime();
            const durationMs = settings.focusDuration * 60 * 1000;
            const targetEnd = start + durationMs;
            
            const tick = () => {
                const now = Date.now();
                const diff = Math.ceil((targetEnd - now) / 1000);
                
                if (diff <= 0) {
                    setTimeLeft(0);
                    setStatus('completed');
                    if (status === 'running') notifyComplete();
                } else {
                    setTimeLeft(diff);
                }
            };
            
            tick();
            const interval = setInterval(tick, 1000);
            return () => clearInterval(interval);
        } else {
            setTimeLeft(settings.focusDuration * 60);
        }
    }, [task, settings.focusDuration, getLatestSession]);

    const notifyComplete = () => {
        const audio = document.getElementById('notification-sound');
        if (audio) audio.play().catch(e => console.log('Audio play failed:', e));
        
        if (Notification.permission === 'granted') {
            new Notification('Focus Session Complete!', {
                body: `Great job on "${task.title}"! Take a break?`,
                icon: '/icons/icon-192.png'
            });
        }
    };

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    if (!task) return (
        <div className="max-w-7xl mx-auto px-4 mt-6">
            <div className="bg-surface dark:bg-navyLight rounded-2xl p-6 border-2 border-dashed border-gray-300 dark:border-gray-700/50 text-center">
                <p className="text-gray-500 dark:text-gray-400 font-medium">No task in focus. Pick one from your list to start! 🚀</p>
            </div>
        </div>
    );

    return (
        <div className="max-w-7xl mx-auto px-4 mt-6">
            <div className="bg-gradient-to-r from-coral to-rose dark:from-rose dark:to-orange-600 rounded-2xl p-6 shadow-xl shadow-rose/20 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
                
                <div className="flex flex-col sm:flex-row items-center justify-between gap-6 relative z-10">
                    <div className="flex items-center gap-4 text-center sm:text-left">
                        <div className="w-4 h-4 rounded-full bg-white animate-pulse shadow-[0_0_10px_rgba(255,255,255,0.6)]"></div>
                        <div>
                            <p className="text-white/90 text-xs font-bold tracking-wider uppercase mb-1">Current Focus</p>
                            <h2 className="text-2xl font-bold truncate max-w-md">{task.title}</h2>
                        </div>
                    </div>

                    <div className="flex flex-col items-center gap-1">
                        <p className="text-5xl font-mono font-bold tracking-tighter tabular-nums drop-shadow-sm">
                            {formatTime(timeLeft)}
                        </p>
                    </div>

                    <div className="flex gap-2">
                        <button onClick={onStop} className="px-4 py-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-xl font-medium transition-all flex items-center gap-2">
                            <FontAwesomeIcon icon={faPause} /> Pause
                        </button>
                        <button onClick={onComplete} className="px-4 py-2 bg-white text-rose font-bold rounded-xl hover:bg-gray-100 shadow-lg transition-all flex items-center gap-2">
                            <FontAwesomeIcon icon={faCheck} /> Done
                        </button>
                        <button onClick={onSwitch} className="px-4 py-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-xl font-medium transition-all" title="Switch Task">
                            <FontAwesomeIcon icon={faExchangeAlt} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FocusBanner;
