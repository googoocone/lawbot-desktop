export type UserRole = 'super_admin' | 'manager' | 'staff';

export type CaseStatus =
  | 'pending'
  | 'filed'
  | 'commenced'
  | 'approved'
  | 'discharged'
  | 'dismissed'
  | 'cancelled'
  | 'withdrawn';

export type CaseType = '회' | '파' | '항' | '일회' | '일';

export type HandlerStatus = '신청서 작성' | '신청서제출' | '기한연장' | '보정서 작성' | '보정서제출';

export type CorrectionStatus =
  | 'pending'
  | 'approaching'
  | 'overdue'
  | 'submitted'
  | 'dismissed';

export type DocumentCategory =
  | 'correction'
  | 'order'
  | 'decision'
  | 'notice'
  | 'other';

export type NotificationType =
  | 'progress_update'
  | 'status_change'
  | 'correction_new'
  | 'deadline_approaching'
  | 'deadline_overdue'
  | 'system';

export type NotificationPriority = 'urgent' | 'normal';

export type CrawlStatus = 'running' | 'completed' | 'failed';

// ============================================================
// Table Row Types
// ============================================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  auth_id: string | null;
  organization_id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Case {
  id: string;
  organization_id: string;
  case_number: string | null;
  case_type: CaseType | null;
  seq_number: number | null;
  applicant_name: string;
  applicant_spouse: string | null;
  applicant_ssn_enc: string | null;
  applicant_phone_enc: string | null;
  court_region: string | null;
  court_name: string | null;
  counselor_name: string | null;
  assigned_to: string | null;
  income_type: string | null;
  fee: number | null;
  doc_received_at: string | null;
  distribution_date: string | null;
  judge_info: string | null;
  judge_phone: string | null;
  creditor_meeting: string | null;
  status: CaseStatus;
  active_corrections_count: number;
  overdue_corrections_count: number;
  handler_checked: boolean;
  handler_checked_at: string | null;
  handler_status: HandlerStatus | null;
  notes: string | null;
  last_crawled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CaseProgress {
  id: string;
  case_id: string;
  progress_date: string | null;
  content: string | null;
  result: string | null;
  notification: string | null;
  is_new: boolean;
  detected_at: string;
  correction_id: string | null;
  created_at: string;
}

export interface CaseCorrection {
  id: string;
  case_id: string;
  organization_id: string;
  document_type: string;
  document_category: DocumentCategory;
  served_date: string | null;
  received_date: string | null;
  auto_confirmed: boolean;
  // deadline_days: removed
  deadline_7d: string | null;
  // deadline_14d: removed
  deadline_date: string | null;
  status: CorrectionStatus;
  overdue_days: number;
  submitted_date: string | null;
  notes_1: string | null;
  notes_2: string | null;
  created_at: string;
  updated_at: string;
}

export interface CorrectionExtension {
  id: string;
  correction_id: string;
  extension_number: number;
  extension_date: string | null;
  extension_days: number | null;
  new_deadline: string | null;
  overdue_after_ext: number;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  case_id: string | null;
  correction_id: string | null;
  organization_id: string;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface CrawlLog {
  id: string;
  organization_id: string;
  started_at: string;
  finished_at: string | null;
  status: CrawlStatus;
  total_cases: number;
  success_count: number;
  fail_count: number;
  new_progress: number;
  new_corrections: number;
  error_log: Record<string, unknown> | null;
  worker_count: number;
  created_at: string;
}

// ============================================================
// Supabase Database Type Definition
// ============================================================

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: Organization;
        Insert: {
          id?: string;
          name: string;
          slug: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: User;
        Insert: {
          id?: string;
          auth_id?: string | null;
          organization_id: string;
          email: string;
          name: string;
          role?: UserRole;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_id?: string | null;
          organization_id?: string;
          email?: string;
          name?: string;
          role?: UserRole;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cases: {
        Row: Case;
        Insert: {
          id?: string;
          organization_id: string;
          case_number?: string | null;
          case_type?: CaseType | null;
          seq_number?: number | null;
          applicant_name: string;
          applicant_spouse?: string | null;
          applicant_ssn_enc?: string | null;
          applicant_phone_enc?: string | null;
          court_region?: string | null;
          court_name?: string | null;
          counselor_name?: string | null;
          assigned_to?: string | null;
          income_type?: string | null;
          fee?: number | null;
          doc_received_at?: string | null;
          distribution_date?: string | null;
          judge_info?: string | null;
          judge_phone?: string | null;
          creditor_meeting?: string | null;
          status?: CaseStatus;
          active_corrections_count?: number;
          overdue_corrections_count?: number;
          handler_checked?: boolean;
          handler_checked_at?: string | null;
          handler_status?: HandlerStatus | null;
          notes?: string | null;
          last_crawled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          case_number?: string | null;
          case_type?: CaseType | null;
          seq_number?: number | null;
          applicant_name?: string;
          applicant_spouse?: string | null;
          applicant_ssn_enc?: string | null;
          applicant_phone_enc?: string | null;
          court_region?: string | null;
          court_name?: string | null;
          counselor_name?: string | null;
          assigned_to?: string | null;
          income_type?: string | null;
          fee?: number | null;
          doc_received_at?: string | null;
          distribution_date?: string | null;
          judge_info?: string | null;
          judge_phone?: string | null;
          creditor_meeting?: string | null;
          status?: CaseStatus;
          active_corrections_count?: number;
          overdue_corrections_count?: number;
          handler_checked?: boolean;
          handler_checked_at?: string | null;
          handler_status?: HandlerStatus | null;
          notes?: string | null;
          last_crawled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      case_progress: {
        Row: CaseProgress;
        Insert: {
          id?: string;
          case_id: string;
          progress_date?: string | null;
          content?: string | null;
          result?: string | null;
          notification?: string | null;
          is_new?: boolean;
          detected_at?: string;
          correction_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          case_id?: string;
          progress_date?: string | null;
          content?: string | null;
          result?: string | null;
          notification?: string | null;
          is_new?: boolean;
          detected_at?: string;
          correction_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      case_corrections: {
        Row: CaseCorrection;
        Insert: {
          id?: string;
          case_id: string;
          organization_id: string;
          document_type: string;
          document_category: DocumentCategory;
          served_date?: string | null;
          received_date?: string | null;
          auto_confirmed?: boolean;
          // deadline_days: removed
          deadline_7d?: string | null;
          // deadline_14d: removed
          deadline_date?: string | null;
          status?: CorrectionStatus;
          overdue_days?: number;
          submitted_date?: string | null;
          notes_1?: string | null;
          notes_2?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          case_id?: string;
          organization_id?: string;
          document_type?: string;
          document_category?: DocumentCategory;
          served_date?: string | null;
          received_date?: string | null;
          auto_confirmed?: boolean;
          // deadline_days: removed
          deadline_7d?: string | null;
          // deadline_14d: removed
          deadline_date?: string | null;
          status?: CorrectionStatus;
          overdue_days?: number;
          submitted_date?: string | null;
          notes_1?: string | null;
          notes_2?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      correction_extensions: {
        Row: CorrectionExtension;
        Insert: {
          id?: string;
          correction_id: string;
          extension_number: number;
          extension_date?: string | null;
          extension_days?: number | null;
          new_deadline?: string | null;
          overdue_after_ext?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          correction_id?: string;
          extension_number?: number;
          extension_date?: string | null;
          extension_days?: number | null;
          new_deadline?: string | null;
          overdue_after_ext?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: Notification;
        Insert: {
          id?: string;
          user_id: string;
          case_id?: string | null;
          correction_id?: string | null;
          organization_id: string;
          type: NotificationType;
          priority?: NotificationPriority;
          title: string;
          message: string;
          is_read?: boolean;
          read_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          case_id?: string | null;
          correction_id?: string | null;
          organization_id?: string;
          type?: NotificationType;
          priority?: NotificationPriority;
          title?: string;
          message?: string;
          is_read?: boolean;
          read_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      crawl_logs: {
        Row: CrawlLog;
        Insert: {
          id?: string;
          organization_id: string;
          started_at: string;
          finished_at?: string | null;
          status?: CrawlStatus;
          total_cases?: number;
          success_count?: number;
          fail_count?: number;
          new_progress?: number;
          new_corrections?: number;
          error_log?: Record<string, unknown> | null;
          worker_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          started_at?: string;
          finished_at?: string | null;
          status?: CrawlStatus;
          total_cases?: number;
          success_count?: number;
          fail_count?: number;
          new_progress?: number;
          new_corrections?: number;
          error_log?: Record<string, unknown> | null;
          worker_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
