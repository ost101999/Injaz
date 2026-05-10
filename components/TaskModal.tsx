import React, { useState, useEffect, useRef } from 'react';
import { Task, Priority, Recurrence, TaskList } from '../types';
import { Icons } from './Icons';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: Partial<Task>) => void;
  onDelete?: (id: string) => void;
  onAddList: (title: string) => string; // Returns new list ID
  taskToEdit?: Task | null;
  lists: TaskList[];
  activeListId: string;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  onAddList,
  taskToEdit,
  lists,
  activeListId
}) => {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>(Priority.Medium);
  const [selectedListId, setSelectedListId] = useState<string>(activeListId);
  const [hasDueDate, setHasDueDate] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>({ frequency: 'none', interval: 1, endDate: null });
  const [imageUrl, setImageUrl] = useState('');

  // Rich Text Ref
  const editorRef = useRef<HTMLDivElement>(null);

  // New List Creation State
  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (isCreatingList) setIsCreatingList(false);
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, isCreatingList]);

  useEffect(() => {
    if (isOpen) {
      if (taskToEdit) {
        setTitle(taskToEdit.title);
        setPriority(taskToEdit.priority);
        setSelectedListId(taskToEdit.listId || activeListId);

        if (taskToEdit.dueDate) {
          setHasDueDate(true);
          setDueDate(taskToEdit.dueDate);
          setDueTime(taskToEdit.dueTime || '');
          setRecurrence(taskToEdit.recurrence || { frequency: 'none', interval: 1, endDate: null });
        } else {
          setHasDueDate(false);
          setDueDate('');
          setDueTime('');
          setRecurrence({ frequency: 'none', interval: 1, endDate: null });
        }
        setImageUrl(taskToEdit.imageUrl || '');
      } else {
        setTitle('');
        setPriority(Priority.Medium);
        setSelectedListId(activeListId);
        setHasDueDate(false);
        setDueDate('');
        setDueTime('');
        setRecurrence({ frequency: 'none', interval: 1, endDate: null });
        setImageUrl('');
      }
      setIsCreatingList(false);
      setNewListName('');
    }
  }, [isOpen, taskToEdit, activeListId]);

  // Sync title with editor ref when opening
  useEffect(() => {
    if (isOpen && editorRef.current) {
      editorRef.current.innerHTML = title;
      editorRef.current.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    // Get content from ref
    const currentContent = editorRef.current ? editorRef.current.innerHTML : title;
    // Basic check for empty text content
    if (!editorRef.current?.innerText.trim() && !currentContent.includes('<img')) return;

    const newTask: Partial<Task> = {
      title: currentContent,
      type: 'item',
      priority,
      color: '#64748b',
      listId: selectedListId,
      parentId: null,
      imageUrl: imageUrl.trim() || undefined,
      ...(taskToEdit ? {} : { isCompleted: false, children: [], createdAt: Date.now() }),
    };

    if (hasDueDate) {
      newTask.dueDate = dueDate;
      newTask.dueTime = dueTime;
      if (recurrence.frequency !== 'none') {
        newTask.recurrence = recurrence;
      }
    } else {
      newTask.dueDate = undefined;
      newTask.dueTime = undefined;
      newTask.recurrence = undefined;
    }

    onSave(newTask);
    onClose();
  };

  const handleAddNewList = () => {
    if (!newListName.trim()) return;
    const newListId = onAddList(newListName);
    setSelectedListId(newListId);
    setIsCreatingList(false);
    setNewListName('');
  };

  const handleDelete = () => {
    if (taskToEdit && onDelete) {
      onDelete(taskToEdit.id);
    }
  };

  const handleListChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === 'NEW_LIST_TRIGGER') {
      setIsCreatingList(true);
    } else {
      setSelectedListId(value);
    }
  };

  // Rich Text Commands
  const execCmd = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const dataUrl = event.target?.result as string;
            setImageUrl(dataUrl);
          };
          reader.readAsDataURL(blob);
          // Only prevent default if we actually found and handled an image
          // This allows normal text paste to still work
          e.preventDefault();
          return;
        }
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-l from-indigo-600 to-purple-600 p-6 text-white flex justify-between items-center">
          <h2 className="text-2xl font-bold">
            {taskToEdit ? 'تعديل المهمة' : 'مهمة جديدة'}
          </h2>
          <button onClick={onClose} className="hover:bg-white/20 p-2 rounded-full transition">
            <Icons.Close size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">

          {/* Title Editor */}
          <div>
            <div className="flex justify-between items-end mb-2">
              <label className="text-gray-700 font-bold">عنوان المهمة</label>
              {/* Rich Text Toolbar */}
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
                <button onMouseDown={(e) => { e.preventDefault(); execCmd('bold'); }} className="p-1.5 hover:bg-white rounded hover:text-indigo-600 transition" title="عريض"><b className="font-serif">B</b></button>
                <button onMouseDown={(e) => { e.preventDefault(); execCmd('underline'); }} className="p-1.5 hover:bg-white rounded hover:text-indigo-600 transition" title="تحته خط"><u className="font-serif">U</u></button>
                <button onMouseDown={(e) => { e.preventDefault(); execCmd('hiliteColor', '#fef08a'); }} className="p-1.5 hover:bg-white rounded hover:text-indigo-600 transition" title="تظليل أصفر"><div className="w-4 h-4 bg-yellow-200 border border-gray-300 rounded-sm"></div></button>
                <div className="w-px h-6 bg-gray-300 mx-1"></div>
                <button onMouseDown={(e) => { e.preventDefault(); execCmd('foreColor', '#ef4444'); }} className="p-1.5 hover:bg-white rounded hover:text-red-500 transition" title="لون أحمر"><div className="w-4 h-4 bg-red-500 rounded-full"></div></button>
                <button onMouseDown={(e) => { e.preventDefault(); execCmd('foreColor', '#3b82f6'); }} className="p-1.5 hover:bg-white rounded hover:text-blue-500 transition" title="لون أزرق"><div className="w-4 h-4 bg-blue-500 rounded-full"></div></button>
              </div>
            </div>

            <div
              ref={editorRef}
              contentEditable
              dir="auto"
              className="w-full px-4 py-3 rounded-xl bg-slate-700 text-white border-2 border-transparent focus:border-indigo-500 focus:outline-none transition text-lg placeholder-slate-400 font-naskh min-h-[120px] max-h-[200px] overflow-y-auto whitespace-pre-wrap leading-relaxed"
              onPaste={handlePaste}
              onKeyDown={(e) => {
                // Enter without Shift -> Save (prevent new line unless shift used)
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSave();
                }
              }}
            ></div>
            <p className="text-[10px] text-gray-400 mt-1 mr-2">* Shift+Enter لسطر جديد</p>
            
            {imageUrl && (
              <div className="mt-3 relative group rounded-xl overflow-hidden border border-gray-200 bg-gray-50 shadow-sm">
                <img 
                  src={imageUrl} 
                  alt="Preview" 
                  className="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <button 
                  onClick={() => setImageUrl('')}
                  className="absolute top-3 right-3 bg-black/60 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500"
                  title="إزالة الصورة"
                >
                  <Icons.Close size={16} />
                </button>
              </div>
            )}
          </div>

          {/* List Selection with Internal Quick Add */}
          <div>
            <label className="block text-gray-700 mb-2 font-bold flex items-center gap-2">
              <Icons.List size={18} className="text-gray-400" />
              القائمة
            </label>

            {isCreatingList ? (
              <div className="flex gap-2 animate-fadeIn">
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="اسم القائمة الجديدة..."
                  className="flex-1 px-4 py-3 rounded-xl bg-gray-50 border border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 font-bold text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddNewList();
                    if (e.key === 'Escape') setIsCreatingList(false);
                  }}
                />
                <button onClick={handleAddNewList} className="bg-indigo-600 text-white px-3 rounded-xl hover:bg-indigo-700"><Icons.Check size={20} /></button>
                <button onClick={() => setIsCreatingList(false)} className="bg-gray-200 text-gray-600 px-3 rounded-xl hover:bg-gray-300"><Icons.Close size={20} /></button>
              </div>
            ) : (
              <div className="relative">
                <select
                  value={selectedListId}
                  onChange={handleListChange}
                  className="w-full px-4 py-3 rounded-xl bg-gray-50 border border-gray-200 text-gray-700 focus:border-indigo-500 focus:outline-none transition appearance-none cursor-pointer font-bold"
                >
                  {lists.map(list => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                  <option disabled>──────────</option>
                  <option value="NEW_LIST_TRIGGER" className="text-indigo-600 font-bold bg-indigo-50">
                    + قائمة جديدة...
                  </option>
                </select>
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400">
                  <Icons.ChevronDown size={18} />
                </div>
              </div>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className="block text-gray-700 mb-2 font-bold">الأولوية</label>
            <div className="flex gap-2">
              {[
                { val: Priority.High, label: 'عالية', color: 'bg-red-50 text-red-600 border-red-200' },
                { val: Priority.Medium, label: 'عادية', color: 'bg-blue-50 text-blue-600 border-blue-200' },
                { val: Priority.Low, label: 'منخفضة', color: 'bg-slate-100 text-slate-700 border-slate-300' },
              ].map((p) => (
                <button
                  key={p.val}
                  onClick={() => setPriority(p.val)}
                  className={`flex-1 py-2 rounded-lg border-2 transition ${priority === p.val ? `border-current ring-2 ring-offset-1 ${p.color}` : 'border-transparent bg-gray-50 text-gray-400'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Time & Date */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <input
                type="checkbox"
                checked={hasDueDate}
                onChange={(e) => setHasDueDate(e.target.checked)}
                className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <label className="font-bold text-gray-700 cursor-pointer" onClick={() => setHasDueDate(!hasDueDate)}>تفعيل التوقيت والتكرار</label>
            </div>

            {hasDueDate && (
              <div className="space-y-4 animate-fadeIn">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-500 mb-1 block">التاريخ</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full p-2 rounded-lg border border-gray-300 font-en"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-500 mb-1 block">الساعة</label>
                    <input
                      type="time"
                      value={dueTime}
                      onChange={(e) => setDueTime(e.target.value)}
                      className="w-full p-2 rounded-lg border border-gray-300 font-en"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-500 mb-1 block flex items-center gap-1">
                    <Icons.Repeat size={14} /> التكرار
                  </label>
                  <select
                    value={recurrence.frequency}
                    onChange={(e) => setRecurrence({ ...recurrence, frequency: e.target.value as any })}
                    className="w-full p-2 rounded-lg border border-gray-300"
                  >
                    <option value="none">بدون تكرار</option>
                    <option value="daily">يومياً</option>
                    <option value="weekly">أسبوعياً</option>
                    <option value="monthly">شهرياً</option>
                    <option value="yearly">سنوياً</option>
                  </select>
                </div>

                {recurrence.frequency !== 'none' && (
                  <div>
                    <label className="text-sm text-gray-500 mb-1 block">تاريخ انتهاء التكرار</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={recurrence.endDate === null}
                        onChange={() => setRecurrence({ ...recurrence, endDate: recurrence.endDate === null ? new Date().toISOString() : null })}
                      />
                      <span className="text-sm">إلى الأبد</span>
                      {recurrence.endDate !== null && (
                        <input
                          type="date"
                          className="font-en p-1 border rounded"
                          onChange={(e) => setRecurrence({ ...recurrence, endDate: e.target.value })}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Image URL Input */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
            <label className="block text-gray-700 mb-2 font-bold flex items-center gap-2">
              <Icons.Image size={18} className="text-gray-400" />
              رابط صورة (اختياري)
            </label>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full px-4 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 focus:border-indigo-500 focus:outline-none transition text-sm font-en"
              dir="ltr"
            />
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t flex gap-3">
          {taskToEdit && (
            <button
              onClick={handleDelete}
              className="px-4 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold hover:bg-red-100 transition flex items-center justify-center"
              title="حذف العنصر"
            >
              <Icons.Trash size={20} />
            </button>
          )}
          <button
            onClick={handleSave}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold text-lg shadow-lg shadow-indigo-200 transition"
          >
            {taskToEdit ? 'حفظ التعديلات' : 'حفظ المهمة'}
          </button>
          <button
            onClick={onClose}
            className="px-6 bg-white border border-gray-300 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-50 transition"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
};