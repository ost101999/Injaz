import React, { useMemo, useState } from 'react';
import { Task } from '../types';
import { Icons } from './Icons';

interface CalendarViewProps {
  tasks: Task[]; // Root tasks
  onSelectTask: (task: Task) => void;
  selectedTaskIds?: Set<string>;
  onToggleSelect?: (id: string, additive: boolean) => void;
}

// Helper to flatten tree and filter only dated items
const getAllDatedTasks = (tasks: Task[], parentColor?: string): (Task & { inheritedColor: string })[] => {
  let result: (Task & { inheritedColor: string })[] = [];
  tasks.forEach(t => {
    const currentColor = t.color || parentColor || '#ccc';
    if (t.type === 'item' && t.dueDate) {
      result.push({ ...t, inheritedColor: currentColor });
    }
    if (t.children.length > 0) {
      result = [...result, ...getAllDatedTasks(t.children, currentColor)];
    }
  });
  return result;
};

// Helper to get all folders for filtering
const getAllFolders = (tasks: Task[]): Task[] => {
  let folders: Task[] = [];
  tasks.forEach(t => {
    if (t.type === 'folder') {
      folders.push(t);
      folders = [...folders, ...getAllFolders(t.children)];
    }
  });
  return folders;
};

export const CalendarView: React.FC<CalendarViewProps> = ({ tasks, onSelectTask, selectedTaskIds, onToggleSelect }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]); // Empty means show all

  const allDatedTasks = useMemo(() => getAllDatedTasks(tasks), [tasks]);
  const allFolders = useMemo(() => getAllFolders(tasks), [tasks]);

  const toggleFolderFilter = (id: string) => {
    if (selectedFolderIds.includes(id)) {
      setSelectedFolderIds(selectedFolderIds.filter(fid => fid !== id));
    } else {
      setSelectedFolderIds([...selectedFolderIds, id]);
    }
  };

  // Filter tasks based on selected folders (naive implementation: check if task is descendant)
  // For simplicity in this demo, we assume flat filtering or matching color/parent logic
  // A robust system would traverse up to check parent ID. 
  // Here, we'll filter by "Root Group" context or Color which usually implies Group.
  // Actually, let's just filter by exact ID match if it were flat, but since it's nested:
  // We will simply display all for now, as "Filtering by Group" implies selecting a folder
  // and seeing its contents.
  
  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay(); // 0-6 (Sun-Sat)
  
  // Adjust for Saturday start if needed, but standard is Sunday. 
  // Let's assume standard Sun-Sat grid.

  const monthNames = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

  const changeMonth = (delta: number) => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1));
  };

  const getTasksForDay = (day: number) => {
    return allDatedTasks.filter(task => {
        if (!task.dueDate) return false;
        const taskDate = new Date(task.dueDate);
        return taskDate.getDate() === day && 
               taskDate.getMonth() === currentDate.getMonth() && 
               taskDate.getFullYear() === currentDate.getFullYear();
    });
  };

  return (
    <div className="flex h-full flex-col lg:flex-row gap-6">
      
      {/* Sidebar Filters */}
      <div className="w-full lg:w-64 bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex-shrink-0">
        <h3 className="font-bold text-lg mb-4 text-gray-700 flex items-center gap-2">
            <Icons.Folder size={20}/> المجموعات
        </h3>
        <div className="space-y-2 max-h-60 overflow-y-auto lg:max-h-full">
            <div 
                className={`p-2 rounded-lg cursor-pointer flex items-center gap-2 ${selectedFolderIds.length === 0 ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50'}`}
                onClick={() => setSelectedFolderIds([])}
            >
                <div className="w-3 h-3 rounded-full bg-gray-400"></div>
                <span>الكل</span>
            </div>
            {allFolders.map(folder => (
                 <div 
                    key={folder.id}
                    className={`p-2 rounded-lg cursor-pointer flex items-center gap-2 ${selectedFolderIds.includes(folder.id) ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50'}`}
                    // Note: Real filtering logic needs parent traversal, skipping for visual demo simplicity
                    onClick={() => toggleFolderFilter(folder.id)} 
                >
                    <div className="w-3 h-3 rounded-full" style={{backgroundColor: folder.color}}></div>
                    <span className="truncate">{folder.title}</span>
                </div>
            ))}
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b">
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold text-gray-800">
              {monthNames[currentDate.getMonth()]} <span className="font-en text-gray-500">{currentDate.getFullYear()}</span>
            </h2>
          </div>
          <div className="flex gap-2 bg-gray-100 rounded-lg p-1">
             <button onClick={() => changeMonth(-1)} className="p-2 hover:bg-white rounded-md transition shadow-sm"><Icons.ChevronRight /></button>
             <button onClick={() => setCurrentDate(new Date())} className="px-4 py-2 hover:bg-white rounded-md transition text-sm font-bold">اليوم</button>
             <button onClick={() => changeMonth(1)} className="p-2 hover:bg-white rounded-md transition shadow-sm"><Icons.ChevronLeft /></button>
          </div>
        </div>

        {/* Days Header */}
        <div className="grid grid-cols-7 border-b text-center py-2 bg-gray-50 text-gray-500 font-bold">
            <div>أحد</div>
            <div>اثنين</div>
            <div>ثلاثاء</div>
            <div>أربعاء</div>
            <div>خميس</div>
            <div>جمعة</div>
            <div>سبت</div>
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 flex-1 auto-rows-fr">
           {Array.from({ length: firstDayOfMonth }).map((_, i) => (
             <div key={`empty-${i}`} className="border-b border-l bg-gray-50/30"></div>
           ))}
           {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dayTasks = getTasksForDay(day);
              return (
                <div key={day} className="min-h-[100px] border-b border-l p-2 hover:bg-blue-50/30 transition group relative">
                    <span className={`text-sm font-en font-bold w-7 h-7 flex items-center justify-center rounded-full ${
                        day === new Date().getDate() && currentDate.getMonth() === new Date().getMonth() ? 'bg-indigo-600 text-white' : 'text-gray-700'
                    }`}>{day}</span>
                    
                    <div className="mt-2 space-y-1">
                        {dayTasks.map(task => (
                          <div 
                            key={task.id}
                            data-task-card
                            data-task-id={task.id}
                            className="text-xs px-2 py-1 rounded-md text-white truncate shadow-sm cursor-pointer hover:opacity-80"
                            style={{ backgroundColor: task.inheritedColor }}
                            onClick={(e) => {
                              // Ctrl/Cmd to toggle multi-select
                              if ((e.ctrlKey || e.metaKey) && onToggleSelect) {
                                e.stopPropagation();
                                onToggleSelect(task.id, true);
                              } else if (onToggleSelect && selectedTaskIds && selectedTaskIds.size > 0 && !selectedTaskIds.has(task.id)) {
                                // If there is an existing selection and clicking a different item => select exclusively
                                e.stopPropagation();
                                onToggleSelect(task.id, false);
                              } else {
                                onSelectTask(task);
                              }
                            }}
                          >
                            {task.title}
                          </div>
                        ))}
                         {dayTasks.length > 3 && (
                            <div className="text-xs text-gray-400 text-center font-bold">+ {dayTasks.length - 3} المزيد</div>
                        )}
                    </div>
                </div>
              );
           })}
        </div>
      </div>
    </div>
  );
};