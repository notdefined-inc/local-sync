import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSun, faMoon, faCoffee, faPlus } from '@fortawesome/free-solid-svg-icons';
import { useRoutines } from '../hooks/useRoutines';
import RoutineCard from './RoutineCard';
import clsx from 'clsx';

const RoutinesView = () => {
    const { routines, logs, addRoutine, toggleRoutine, deleteRoutine } = useRoutines();
    const [showAddModal, setShowAddModal] = useState(false);

    const isDone = (id) => logs.some(l => l.routineId === id);

    const sections = [
        { id: 'morning', label: 'Morning', icon: faCoffee, color: 'text-amber-500' },
        { id: 'afternoon', label: 'Afternoon', icon: faSun, color: 'text-orange-500' },
        { id: 'evening', label: 'Evening', icon: faMoon, color: 'text-indigo-400' }
    ];

    return (
        <div className="max-w-5xl mx-auto px-4 mt-6 pb-20">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Daily Routines</h2>
                <button 
                    onClick={() => setShowAddModal(true)}
                    className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primaryDark transition-colors shadow-lg shadow-primary/30 flex items-center gap-2"
                >
                    <FontAwesomeIcon icon={faPlus} /> Add Routine
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {sections.map(section => (
                    <div key={section.id} className="bg-surface/30 dark:bg-navyLight/20 rounded-2xl p-4 border border-white/50 dark:border-white/5">
                        <div className="flex items-center gap-3 mb-4 px-2">
                            <FontAwesomeIcon icon={section.icon} className={`text-xl ${section.color}`} />
                            <h3 className="font-bold text-gray-700 dark:text-gray-200">{section.label}</h3>
                            <span className="ml-auto text-xs font-mono bg-white dark:bg-navy px-2 py-1 rounded-lg opacity-60">
                                {routines.filter(r => r.timeOfDay === section.id).length}
                            </span>
                        </div>
                        
                        <div className="space-y-3">
                            {routines.filter(r => r.timeOfDay === section.id).map(routine => (
                                <RoutineCard 
                                    key={routine.id} 
                                    routine={routine} 
                                    isDone={isDone(routine.id)} 
                                    onToggle={toggleRoutine}
                                    onDelete={deleteRoutine}
                                />
                            ))}
                            
                            {routines.filter(r => r.timeOfDay === section.id).length === 0 && (
                                <div className="text-center py-8 text-gray-400 dark:text-gray-600 text-sm italic">
                                    No routines for {section.id} yet.
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Add Routine Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 modal-backdrop flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-navyLight rounded-2xl p-6 w-full max-w-md shadow-2xl transform transition-all scale-100">
                        <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-6">Create New Routine</h3>
                        <form onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.target);
                            addRoutine({
                                title: formData.get('title'),
                                timeOfDay: formData.get('timeOfDay'),
                                estimatedMinutes: parseInt(formData.get('estimatedMinutes')) || 5,
                                sortOrder: 0
                            });
                            setShowAddModal(false);
                        }}>
                            <div className="space-y-5">
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Title</label>
                                    <input 
                                        name="title" 
                                        required 
                                        className="w-full px-4 py-3 rounded-xl bg-surface dark:bg-navy border-2 border-transparent focus:border-primary dark:text-white outline-none transition-all placeholder-gray-400" 
                                        placeholder="e.g. Morning Stretch"
                                        autoFocus
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Time of Day</label>
                                        <select name="timeOfDay" className="w-full px-4 py-3 rounded-xl bg-surface dark:bg-navy border-2 border-transparent focus:border-primary dark:text-white outline-none">
                                            <option value="morning">Morning</option>
                                            <option value="afternoon">Afternoon</option>
                                            <option value="evening">Evening</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Duration (min)</label>
                                        <input type="number" name="estimatedMinutes" defaultValue="5" className="w-full px-4 py-3 rounded-xl bg-surface dark:bg-navy border-2 border-transparent focus:border-primary dark:text-white outline-none" />
                                    </div>
                                </div>
                                <div className="flex justify-end gap-3 mt-8">
                                    <button 
                                        type="button" 
                                        onClick={() => setShowAddModal(false)} 
                                        className="px-5 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        type="submit" 
                                        className="px-5 py-2.5 bg-primary text-white rounded-xl font-bold hover:bg-primaryDark transition-colors shadow-lg shadow-primary/20"
                                    >
                                        Add Routine
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RoutinesView;
