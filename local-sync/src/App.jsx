import React, { useState, useEffect } from 'react';
import { AppProvider } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useSettings } from './hooks/useSettings';
import { useTasks } from './hooks/useTasks';
import Header from './components/Header';
import FocusBanner from './components/FocusBanner';
import KanbanColumn from './components/KanbanColumn';
import QuickAddTask from './components/QuickAddTask';
import RoutinesView from './components/RoutinesView';
import Login from './components/Login';
import LocalSyncDemo from './components/LocalSyncDemo';

const App = () => {
    return (
        <AuthProvider>
            <AppContent />
        </AuthProvider>
    );
};

const AppContent = () => {
    const { profile, loading: authLoading, dbReady } = useAuth();

    // Show loading while DB initializes
    if (!dbReady || authLoading) {
        return (
            <div className="h-screen flex items-center justify-center bg-cream dark:bg-navy text-primary">
                <div className="text-center">
                    <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-500">Initializing...</p>
                </div>
            </div>
        );
    }

    // Show login if not authenticated
    if (!profile) {
        return <Login />;
    }

    // Show main app
    return <MainDashboard />;
};

// Separated component to ensure hooks only run after auth
const MainDashboard = () => {
    const { settings, updateSetting, loading } = useSettings();
    const { tasks, addTask, updateTask, deleteTask, setCurrentFocus } = useTasks();
    const [activeTab, setActiveTab] = useState('tasks');
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        if (!loading) {
            document.documentElement.classList.toggle('dark', settings.theme === 'dark');
        }
    }, [settings.theme, loading]);

    const currentFocusTask = tasks.find(t => t.isCurrentFocus);

    const filteredTasks = tasks.filter(t => 
        t.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleDropTask = (taskId, newStatus) => {
        updateTask(taskId, { status: newStatus });
    };

    if (loading) return (
        <div className="h-screen flex items-center justify-center bg-cream dark:bg-navy text-primary">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
    );

    return (
        <AppProvider value={{ settings, updateSetting }}>
            <div className="min-h-screen bg-cream dark:bg-navy pb-20 transition-colors">
                <Header searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
                
                <FocusBanner 
                    task={currentFocusTask}
                    onStop={() => setCurrentFocus(null)}
                    onComplete={() => updateTask(currentFocusTask.id, { status: 'done', isCurrentFocus: false })}
                    onSwitch={() => setCurrentFocus(null)}
                />
                
                {/* Tab Navigation */}
                <div className="flex justify-center mt-6">
                    <div className="flex gap-1 bg-surface dark:bg-navyLight p-1 rounded-xl shadow-inner">
                        {['tasks', 'routines', 'stats', 'demo'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className={`py-2 px-6 rounded-lg text-sm font-bold capitalize transition-all ${
                                    activeTab === tab 
                                    ? 'bg-white dark:bg-navy text-primary shadow-sm scale-105' 
                                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
                                }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>
                
                <main className="mt-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    {activeTab === 'tasks' && (
                        <div className="flex gap-6 overflow-x-auto pb-6 scrollbar-hide min-h-[500px]">
                            <KanbanColumn 
                                title="Today" status="today" icon="📅" 
                                tasks={filteredTasks.filter(t => t.status === 'today')} 
                                onDropTask={handleDropTask} onFocus={setCurrentFocus} onComplete={(t) => updateTask(t.id, { status: 'done' })} onDelete={(t) => deleteTask(t.id)}
                            />
                            <KanbanColumn 
                                title="In Progress" status="progress" icon="🚀" 
                                tasks={filteredTasks.filter(t => t.status === 'progress')} 
                                onDropTask={handleDropTask} onFocus={setCurrentFocus} onComplete={(t) => updateTask(t.id, { status: 'done' })} onDelete={(t) => deleteTask(t.id)}
                            />
                            <KanbanColumn 
                                title="Done" status="done" icon="✅" 
                                tasks={filteredTasks.filter(t => t.status === 'done')} 
                                onDropTask={handleDropTask} onFocus={setCurrentFocus} onComplete={(t) => updateTask(t.id, { status: 'done' })} onDelete={(t) => deleteTask(t.id)}
                            />
                        </div>
                    )}
                    {activeTab === 'routines' && <RoutinesView />}
                    {activeTab === 'stats' && (
                        <div className="flex items-center justify-center h-64 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-2xl bg-white/50 dark:bg-navyLight/20">
                            <div className="text-center text-gray-500">
                                <p className="text-2xl mb-2">📊</p>
                                <p>Statistics Dashboard Coming Soon</p>
                            </div>
                        </div>
                    )}
                    {activeTab === 'demo' && <LocalSyncDemo />}
                </main>
                
                <QuickAddTask onAdd={addTask} />
            </div>
        </AppProvider>
    );
};

export default App;
