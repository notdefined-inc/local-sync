import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faCog, faBrain } from '@fortawesome/free-solid-svg-icons';
import ThemeToggle from './ThemeToggle';

const Header = ({ searchQuery, setSearchQuery }) => {
    return (
        <header className="bg-white dark:bg-navy border-b border-surface dark:border-navyLight px-4 py-3 sticky top-0 z-10 shadow-sm">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg">
                        <FontAwesomeIcon icon={faBrain} className="text-white text-lg" />
                    </div>
                    <h1 className="text-lg font-bold text-gray-800 dark:text-white hidden sm:block tracking-tight">
                        ADHD Focus
                    </h1>
                </div>
                
                <div className="flex items-center gap-2 flex-1 max-w-md mx-4">
                    <div className="relative w-full group">
                        <input 
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search tasks..."
                            className="w-full px-4 py-2 pl-10 rounded-xl bg-surface dark:bg-navyLight border border-transparent focus:border-primary dark:focus:border-primary focus:bg-white dark:focus:bg-navyLight outline-none text-sm transition-all shadow-inner"
                        />
                        <FontAwesomeIcon 
                            icon={faSearch} 
                            className="absolute left-3 top-2.5 text-gray-400 group-focus-within:text-primary transition-colors" 
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <button className="p-2 rounded-lg hover:bg-surface dark:hover:bg-navyLight text-gray-600 dark:text-gray-300 transition-colors">
                        <FontAwesomeIcon icon={faCog} className="text-lg" />
                    </button>
                </div>
            </div>
        </header>
    );
};

export default Header;
