import React, { useMemo } from 'react';
import TaskCard from './TaskCard';

const KanbanColumn = ({ title, status, icon, tasks, onDropTask, onFocus, onComplete, onDelete }) => {
    const handleDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) onDropTask(taskId, status);
    };

    const taskCount = tasks.length;

    return (
        <div 
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="flex-1 min-w-[300px] flex flex-col h-full"
        >
            <div className="flex items-center gap-3 mb-4 px-2">
                <span className="text-2xl filter drop-shadow-sm">{icon}</span>
                <h3 className="font-bold text-gray-700 dark:text-gray-200 text-lg">{title}</h3>
                <span className="text-xs font-semibold bg-gray-200 dark:bg-navyLight text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
                    {taskCount}
                </span>
            </div>
            
            <div className="flex-1 bg-surface/50 dark:bg-black/20 rounded-2xl p-3 space-y-3 transition-colors hover:bg-surface/70 dark:hover:bg-black/30 min-h-[200px] border border-transparent hover:border-gray-200 dark:hover:border-gray-700/50">
                {tasks.map(task => (
                    <TaskCard 
                        key={task.id} 
                        task={task} 
                        onFocus={onFocus} 
                        onComplete={onComplete} 
                        onDelete={onDelete} 
                    />
                ))}
                
                {taskCount === 0 && (
                    <div className="h-32 flex flex-col items-center justify-center text-gray-400 text-sm border-2 border-dashed border-gray-300 dark:border-gray-700/50 rounded-xl bg-white/50 dark:bg-navyLight/20">
                        <p>No tasks yet</p>
                        <p className="text-xs opacity-60 mt-1">Drop one here!</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default KanbanColumn;
