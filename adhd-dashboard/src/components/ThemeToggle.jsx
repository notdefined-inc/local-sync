import React from 'react';
import { useAppContext } from '../context/AppContext';

const ThemeToggle = () => {
    const { settings, updateSetting } = useAppContext();
    const isDark = settings.theme === 'dark';
    
    const toggle = () => {
        const newTheme = isDark ? 'light' : 'dark';
        updateSetting('theme', newTheme);
        document.documentElement.classList.toggle('dark', newTheme === 'dark');
    };

    return (
        <button 
            onClick={toggle} 
            className="p-2 rounded-lg hover:bg-surface dark:hover:bg-navyLight transition-colors text-2xl"
            title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
            {isDark ? '☀️' : '🌙'}
        </button>
    );
};

export default ThemeToggle;
