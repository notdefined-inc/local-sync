import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBullseye, faCheck, faTrash, faGripVertical } from '@fortawesome/free-solid-svg-icons';

const TaskCard = ({ task, onFocus, onComplete, onDelete }) => {
    const handleDragStart = (e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
        e.target.style.opacity = '0.5';
    };

    const handleDragEnd = (e) => {
        e.target.style.opacity = '1';
    };

    return (
        <div 
            draggable="true"
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            className="group bg-white dark:bg-navyLight rounded-xl p-4 shadow-sm border border-transparent hover:border-primary/20 hover:shadow-md transition-all cursor-grab active:cursor-grabbing relative"
        >
            <div className="flex items-start gap-3">
                <div className="mt-1 text-gray-300 dark:text-gray-600 cursor-grab">
                    <FontAwesomeIcon icon={faGripVertical} />
                </div>
                
                <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-800 dark:text-white truncate">{task.title}</h3>
                    {task.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                    )}
                    
                    <div className="flex items-center justify-between mt-3">
                        <div className="flex gap-1">
                            {task.priority > 0 && (
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                    task.priority >= 2 
                                    ? 'bg-rose/10 text-rose' 
                                    : 'bg-amber/10 text-amber'
                                }`}>
                                    P{task.priority}
                                </span>
                            )}
                        </div>
                        
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0 bg-white dark:bg-navyLight pl-2">
                            <button 
                                onClick={(e) => { e.stopPropagation(); onFocus(task); }} 
                                className="p-1.5 hover:bg-primary/10 text-gray-400 hover:text-primary rounded-lg transition-colors" 
                                title="Focus"
                            >
                                <FontAwesomeIcon icon={faBullseye} />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); onComplete(task); }} 
                                className="p-1.5 hover:bg-secondary/10 text-gray-400 hover:text-secondary rounded-lg transition-colors" 
                                title="Done"
                            >
                                <FontAwesomeIcon icon={faCheck} />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); onDelete(task); }} 
                                className="p-1.5 hover:bg-coral/10 text-gray-400 hover:text-coral rounded-lg transition-colors" 
                                title="Delete"
                            >
                                <FontAwesomeIcon icon={faTrash} />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TaskCard;
