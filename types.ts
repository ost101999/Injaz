export enum Priority {
  High = 1,
  Medium = 2,
  Low = 3,
}

export type ViewMode = 'list' | 'grid' | 'board' | 'groups';

export interface Recurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'none';
  interval: number; // e.g., every 2 days
  endDate?: string | null; // ISO Date or null for forever
}

export interface TaskList {
  id: string;
  title: string;
  icon?: string;
  themeColor?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  type: 'folder' | 'item';
  color: string; // Hex code
  priority: Priority;
  parentId: string | null;
  listId?: string; // Links root tasks to a specific list
  googleTaskId?: string; // Links to Google Tasks API ID
  googleListId?: string; // Stores which Google list this task belongs to
  isGoogleSynced?: boolean;
  isArchived?: boolean;
  children: Task[]; // Recursive structure
  isCompleted: boolean;
  dueDate?: string; // ISO Date string
  dueTime?: string; // HH:mm
  recurrence?: Recurrence;
  createdAt: number;
  completedAt?: number;
  pinStatus?: 'top' | 'bottom' | null;
  imageUrl?: string;
}

export interface Breadcrumb {
  id: string;
  title: string;
}

export interface Habit {
  id: string;
  title: string;
  category?: string;
  color: string;
  icon: string;
  completions: string[]; // YYYY-MM-DD dates for "done"
  missed?: string[]; // YYYY-MM-DD dates for "didn't do it" (right-click)
  duration?: number; // Duration in minutes
  goal?: {
    type: 'days' | 'weeks' | 'months' | 'count' | 'custom_date';
    value: number;
    startDate: number;
    targetDate?: string; // YYYY-MM-DD
  };
  isFinished?: boolean;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'custom';
  customDays?: number[]; // [0, 1, 2, 3, 4, 5, 6] for Sunday to Saturday
  isLastDayOfMonth?: boolean;
  groupId?: string;
  createdAt: number;
}