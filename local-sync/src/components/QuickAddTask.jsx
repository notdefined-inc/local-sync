import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTimes } from '@fortawesome/free-solid-svg-icons';

const QuickAddTask = ({ onAdd }) => {
    const [title, setTitle] = useState('');
    const [isOpen, setIsOpen] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (title.trim()) {
            onAdd({ title: title.trim() });
            setTitle('');
            setIsOpen(false);
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-8 right-8 w-14 h-14 bg-primary hover:bg-primaryDark text-white rounded-full shadow-lg shadow-primary/40 flex items-center justify-center text-xl z-40 transition-transform hover:scale-110 active:scale-95"
            >
                <FontAwesomeIcon icon={faPlus} />
            </button>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 modal-backdrop flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-navyLight rounded-2xl p-5 w-full max-w-lg shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white">Quick Add Task</h3>
                    <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                        <FontAwesomeIcon icon={faTimes} />
                    </button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="relative">
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="What needs to be done? Press Enter"
                            className="w-full px-5 py-4 rounded-xl bg-surface dark:bg-navy border-2 border-transparent focus:border-primary text-gray-800 dark:text-white placeholder-gray-400 outline-none text-lg"
                            autoFocus
                        />
                        <button
                            type="submit"
                            className="absolute right-2 top-2 bottom-2 px-4 bg-primary text-white rounded-lg hover:bg-primaryDark transition-colors font-medium shadow-sm"
                        >
                            <FontAwesomeIcon icon={faPlus} />
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default QuickAddTask;
