import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faClock, faTimes } from '@fortawesome/free-solid-svg-icons';

const RoutineCard = ({ routine, isDone, onToggle, onDelete }) => {
    return (
        <div className={`p-4 rounded-xl border flex items-center justify-between transition-all group ${
            isDone 
                ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-900/30' 
                : 'bg-white dark:bg-navyLight border-gray-100 dark:border-gray-700 hover:border-primary/30 hover:shadow-md'
        }`}>
            <div className="flex items-center gap-4">
                <button 
                    onClick={() => onToggle(routine.id)}
                    title="Toggle Completion"
                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${
                        isDone 
                            ? 'bg-secondary border-secondary text-white scale-110' 
                            : 'border-gray-300 dark:border-gray-500 hover:border-primary hover:bg-primary/5 text-transparent hover:text-primary/30'
                    }`}
                >
                    <FontAwesomeIcon icon={faCheck} className={`transform transition-transform ${isDone ? 'scale-100' : 'scale-0'}`} />
                </button>
                <div>
                    <h4 className={`font-medium text-lg ${isDone ? 'text-gray-400 line-through' : 'text-gray-800 dark:text-white'}`}>
                        {routine.title}
                    </h4>
                    <p className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                        <span className="capitalize opacity-75">{routine.timeOfDay}</span>
                        {routine.estimatedMinutes && (
                            <span className="flex items-center gap-1 bg-gray-100 dark:bg-navy px-1.5 py-0.5 rounded text-[10px]">
                                <FontAwesomeIcon icon={faClock} /> {routine.estimatedMinutes}m
                            </span>
                        )}
                    </p>
                </div>
            </div>
            <button 
                onClick={() => onDelete(routine.id)} 
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-300 hover:text-coral hover:bg-coral/10 opacity-0 group-hover:opacity-100 transition-all"
            >
                <FontAwesomeIcon icon={faTimes} />
            </button>
        </div>
    );
};

export default RoutineCard;
