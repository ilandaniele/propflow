export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<{
          id: string;
          name: string;
          slug: string | null;
          created_at: string;
          updated_at: string;
        }> & { name: string };
        Update: Partial<{
          id: string;
          name: string;
          slug: string | null;
          updated_at: string;
        }>;
      };
      profiles: {
        Row: {
          id: string;
          org_id: string;
          role: 'admin' | 'tenant';
          full_name: string | null;
          email: string | null;
          phone: string | null;
          preferred_language: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          org_id: string;
          role: 'admin' | 'tenant';
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          preferred_language?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          role?: 'admin' | 'tenant';
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          preferred_language?: string | null;
          updated_at?: string;
        };
      };
      properties: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          address: string | null;
          city: string | null;
          country: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          name: string;
          address?: string | null;
          city?: string | null;
          country?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          address?: string | null;
          city?: string | null;
          country?: string | null;
          updated_at?: string;
        };
      };
      units: {
        Row: {
          id: string;
          org_id: string;
          property_id: string;
          label: string;
          floor: string | null;
          bedrooms: number | null;
          monthly_rent_default: number | null;
          status: 'vacant' | 'occupied';
          // Added in migration 000025
          toilet_type: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          property_id: string;
          label: string;
          floor?: string | null;
          bedrooms?: number | null;
          monthly_rent_default?: number | null;
          status?: 'vacant' | 'occupied';
          toilet_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          label?: string;
          floor?: string | null;
          bedrooms?: number | null;
          monthly_rent_default?: number | null;
          status?: 'vacant' | 'occupied';
          toilet_type?: string | null;
          updated_at?: string;
        };
      };
      tenants: {
        Row: {
          id: string;
          org_id: string;
          profile_id: string | null;
          full_name: string;
          email: string | null;
          phone: string | null;
          unit_id: string | null;
          notes: string | null;
          // Added in migration 000022 (Phase 4 columns) — drive-by fix for type drift
          photo_url: string | null;
          whatsapp_phone: string | null;
          whatsapp_opt_in: boolean | null;
          reliability_scores: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          profile_id?: string | null;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          unit_id?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          whatsapp_phone?: string | null;
          whatsapp_opt_in?: boolean | null;
          reliability_scores?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          profile_id?: string | null;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          unit_id?: string | null;
          notes?: string | null;
          photo_url?: string | null;
          whatsapp_phone?: string | null;
          whatsapp_opt_in?: boolean | null;
          reliability_scores?: Json | null;
          updated_at?: string;
        };
      };
      contracts: {
        Row: {
          id: string;
          org_id: string;
          tenant_id: string;
          unit_id: string;
          start_date: string;
          end_date: string;
          monthly_rent: number;
          status: 'active' | 'expired' | 'terminated';
          deposit: number | null;
          document_url: string | null;
          signed_at: string | null;
          signature_status: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          tenant_id: string;
          unit_id: string;
          start_date: string;
          end_date: string;
          monthly_rent: number;
          status?: 'active' | 'expired' | 'terminated';
          deposit?: number | null;
          document_url?: string | null;
          signed_at?: string | null;
          signature_status?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: 'active' | 'expired' | 'terminated';
          end_date?: string;
          monthly_rent?: number;
          deposit?: number | null;
          updated_at?: string;
        };
      };
      charges: {
        Row: {
          id: string;
          org_id: string;
          contract_id: string;
          tenant_id: string;
          period: string | null;
          description: string | null;
          amount: number;
          due_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          contract_id: string;
          tenant_id: string;
          period?: string | null;
          description?: string | null;
          amount: number;
          due_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          description?: string | null;
          amount?: number;
          due_date?: string | null;
          updated_at?: string;
        };
      };
      payments: {
        Row: {
          id: string;
          org_id: string;
          contract_id: string;
          tenant_id: string;
          amount: number;
          paid_at: string;
          method: 'cash' | 'transfer' | 'card' | 'other';
          status: 'pending' | 'approved';
          approved_by: string | null;
          approved_at: string | null;
          reference: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          contract_id: string;
          tenant_id: string;
          amount: number;
          paid_at: string;
          method?: 'cash' | 'transfer' | 'card' | 'other';
          status?: 'pending' | 'approved';
          approved_by?: string | null;
          approved_at?: string | null;
          reference?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: 'pending' | 'approved';
          approved_by?: string | null;
          approved_at?: string | null;
          updated_at?: string;
        };
      };
      incidents: {
        Row: {
          id: string;
          org_id: string;
          unit_id: string | null;
          property_id: string | null;
          created_by: string;
          tenant_id: string | null;
          assigned_to: string | null;
          category: 'plumbing' | 'electrical' | 'appliance' | 'structural' | 'cleaning' | 'other';
          title: string;
          description: string;
          priority: 'low' | 'medium' | 'high' | 'urgent';
          status: 'pending' | 'in_progress' | 'solved';
          photo_path: string | null;
          resolved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          unit_id?: string | null;
          property_id?: string | null;
          created_by: string;
          tenant_id?: string | null;
          assigned_to?: string | null;
          category: 'plumbing' | 'electrical' | 'appliance' | 'structural' | 'cleaning' | 'other';
          title: string;
          description: string;
          priority?: 'low' | 'medium' | 'high' | 'urgent';
          status?: 'pending' | 'in_progress' | 'solved';
          photo_path?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          unit_id?: string | null;
          property_id?: string | null;
          tenant_id?: string | null;
          assigned_to?: string | null;
          category?: 'plumbing' | 'electrical' | 'appliance' | 'structural' | 'cleaning' | 'other';
          title?: string;
          description?: string;
          priority?: 'low' | 'medium' | 'high' | 'urgent';
          status?: 'pending' | 'in_progress' | 'solved';
          photo_path?: string | null;
          resolved_at?: string | null;
          updated_at?: string;
        };
      };
      incident_comments: {
        Row: {
          id: string;
          org_id: string;
          incident_id: string;
          author_id: string;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          incident_id: string;
          author_id: string;
          body: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          updated_at?: string;
        };
      };
      // Added in migration 000035
      unit_images: {
        Row: {
          id: string;
          org_id: string;
          unit_id: string;
          storage_path: string;
          filename: string;
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
          size_bytes: number;
          width: number | null;
          height: number | null;
          is_cover: boolean;
          caption: string | null;
          sort_order: number;
          uploaded_by: string;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          unit_id: string;
          storage_path: string;
          filename: string;
          mime_type: 'image/jpeg' | 'image/png' | 'image/webp';
          size_bytes: number;
          width?: number | null;
          height?: number | null;
          is_cover?: boolean;
          caption?: string | null;
          sort_order?: number;
          uploaded_by: string;
          uploaded_at?: string;
        };
        Update: {
          storage_path?: string;
          filename?: string;
          mime_type?: 'image/jpeg' | 'image/png' | 'image/webp';
          size_bytes?: number;
          width?: number | null;
          height?: number | null;
          is_cover?: boolean;
          caption?: string | null;
          sort_order?: number;
          uploaded_by?: string;
          uploaded_at?: string;
        };
      };
    };
    Views: {
      tenant_statement: {
        Row: {
          tenant_id: string;
          org_id: string;
          total_charges: number;
          total_approved_payments: number;
          balance: number;
          is_overdue: boolean;
        };
      };
    };
    Functions: {
      current_org_id: {
        Args: Record<string, never>;
        Returns: string;
      };
      current_role: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: Record<string, never>;
  };
}

// ─── Phase 2 table types (14 new tables) ─────────────────────────────────────

// Module 1: Payment & Financial Intelligence
export interface ExpenseCategory {
  id: string;
  org_id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}
export interface ExpenseCategoryInsert {
  id?: string;
  org_id: string;
  name: string;
  color?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface ExpenseCategoryUpdate {
  name?: string;
  color?: string | null;
  updated_at?: string;
}

export interface Expense {
  id: string;
  org_id: string;
  property_id: string | null;
  unit_id: string | null;
  category_id: string | null;
  amount: number;
  description: string;
  incurred_on: string;
  receipt_path: string | null;
  created_at: string;
  updated_at: string;
}
export interface ExpenseInsert {
  id?: string;
  org_id: string;
  property_id?: string | null;
  unit_id?: string | null;
  category_id?: string | null;
  amount: number;
  description: string;
  incurred_on: string;
  receipt_path?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface ExpenseUpdate {
  property_id?: string | null;
  unit_id?: string | null;
  category_id?: string | null;
  amount?: number;
  description?: string;
  incurred_on?: string;
  receipt_path?: string | null;
  updated_at?: string;
}

export type OcrStatus = 'pending' | 'processing' | 'extracted' | 'failed' | 'matched';
export interface ReceiptUpload {
  id: string;
  org_id: string;
  payment_id: string | null;
  uploaded_by: string;
  file_path: string;
  ocr_status: OcrStatus;
  extracted_amount: number | null;
  extracted_date: string | null;
  extracted_vendor: string | null;
  confidence: number | null;
  ocr_error: string | null;
  created_at: string;
  updated_at: string;
}
export interface ReceiptUploadInsert {
  id?: string;
  org_id: string;
  payment_id?: string | null;
  uploaded_by: string;
  file_path: string;
  ocr_status?: OcrStatus;
  extracted_amount?: number | null;
  extracted_date?: string | null;
  extracted_vendor?: string | null;
  confidence?: number | null;
  ocr_error?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface ReceiptUploadUpdate {
  payment_id?: string | null;
  ocr_status?: OcrStatus;
  extracted_amount?: number | null;
  extracted_date?: string | null;
  extracted_vendor?: string | null;
  confidence?: number | null;
  ocr_error?: string | null;
  updated_at?: string;
}

// Module 2: Contract Completion
export interface ContractTemplate {
  id: string;
  org_id: string;
  name: string;
  body_markdown: string;
  variables: unknown; // jsonb: string[]
  created_at: string;
  updated_at: string;
}
export interface ContractTemplateInsert {
  id?: string;
  org_id: string;
  name: string;
  body_markdown: string;
  variables?: unknown;
  created_at?: string;
  updated_at?: string;
}
export interface ContractTemplateUpdate {
  name?: string;
  body_markdown?: string;
  variables?: unknown;
  updated_at?: string;
}

export interface PricingTable {
  id: string;
  org_id: string;
  name: string;
  property_type: string;
  market_zone: string;
  tiers: unknown; // jsonb: PricingTier[]
  created_at: string;
  updated_at: string;
}
export interface PricingTableInsert {
  id?: string;
  org_id: string;
  name: string;
  property_type: string;
  market_zone: string;
  tiers?: unknown;
  created_at?: string;
  updated_at?: string;
}
export interface PricingTableUpdate {
  name?: string;
  property_type?: string;
  market_zone?: string;
  tiers?: unknown;
  updated_at?: string;
}

export type SignatureRequestStatus = 'sent' | 'viewed' | 'signed' | 'declined' | 'expired';
export interface SignatureRequest {
  id: string;
  org_id: string;
  contract_id: string;
  signer_profile_id: string | null;
  signer_email: string;
  token: string;
  status: SignatureRequestStatus;
  sent_at: string;
  viewed_at: string | null;
  signed_at: string | null;
  expires_at: string;
  signature_image_path: string | null;
  signed_ip: string | null;
  signed_user_agent: string | null;
  created_at: string;
  updated_at: string;
}
export interface SignatureRequestInsert {
  id?: string;
  org_id: string;
  contract_id: string;
  signer_profile_id?: string | null;
  signer_email: string;
  token?: string;
  status?: SignatureRequestStatus;
  sent_at?: string;
  viewed_at?: string | null;
  signed_at?: string | null;
  expires_at: string;
  signature_image_path?: string | null;
  signed_ip?: string | null;
  signed_user_agent?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface SignatureRequestUpdate {
  status?: SignatureRequestStatus;
  viewed_at?: string | null;
  signed_at?: string | null;
  signature_image_path?: string | null;
  signed_ip?: string | null;
  signed_user_agent?: string | null;
  updated_at?: string;
}

// Module 3: Operations Automation
export type AnnouncementAudience = 'all' | 'property' | 'unit';
export interface Announcement {
  id: string;
  org_id: string;
  created_by: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  property_id: string | null;
  unit_id: string | null;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface AnnouncementInsert {
  id?: string;
  org_id: string;
  created_by: string;
  title: string;
  body: string;
  audience?: AnnouncementAudience;
  property_id?: string | null;
  unit_id?: string | null;
  published_at?: string | null;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface AnnouncementUpdate {
  title?: string;
  body?: string;
  audience?: AnnouncementAudience;
  property_id?: string | null;
  unit_id?: string | null;
  published_at?: string | null;
  expires_at?: string | null;
  updated_at?: string;
}

export type CleaningTaskStatus = 'pending' | 'in_progress' | 'done';
export interface CleaningTask {
  id: string;
  org_id: string;
  unit_id: string | null;
  assigned_to: string | null;
  title: string;
  scheduled_date: string;
  status: CleaningTaskStatus;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface CleaningTaskInsert {
  id?: string;
  org_id: string;
  unit_id?: string | null;
  assigned_to?: string | null;
  title: string;
  scheduled_date: string;
  status?: CleaningTaskStatus;
  notes?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface CleaningTaskUpdate {
  unit_id?: string | null;
  assigned_to?: string | null;
  title?: string;
  scheduled_date?: string;
  status?: CleaningTaskStatus;
  notes?: string | null;
  completed_at?: string | null;
  updated_at?: string;
}

export type CrmLeadStatus = 'new' | 'contacted' | 'qualified' | 'lost';
export interface CrmLead {
  id: string;
  org_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  property_interest: string | null;
  source: string | null;
  status: CrmLeadStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface CrmLeadInsert {
  id?: string;
  org_id: string;
  full_name: string;
  email?: string | null;
  phone?: string | null;
  property_interest?: string | null;
  source?: string | null;
  status?: CrmLeadStatus;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface CrmLeadUpdate {
  full_name?: string;
  email?: string | null;
  phone?: string | null;
  property_interest?: string | null;
  source?: string | null;
  status?: CrmLeadStatus;
  notes?: string | null;
  updated_at?: string;
}

export type ReminderType = 'lease_renewal' | 'payment_due' | 'custom';
export type ReminderTargetType = 'contract' | 'charge' | 'tenant';
export type ReminderChannel = 'email' | 'in_app' | 'both';
export type ReminderStatus = 'scheduled' | 'sent' | 'failed' | 'skipped';
export interface Reminder {
  id: string;
  org_id: string;
  type: ReminderType;
  target_type: ReminderTargetType;
  target_id: string;
  channel: ReminderChannel;
  scheduled_for: string;
  sent_at: string | null;
  status: ReminderStatus;
  message_preview: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
export interface ReminderInsert {
  id?: string;
  org_id: string;
  type: ReminderType;
  target_type: ReminderTargetType;
  target_id: string;
  channel?: ReminderChannel;
  scheduled_for: string;
  sent_at?: string | null;
  status?: ReminderStatus;
  message_preview?: string | null;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface ReminderUpdate {
  sent_at?: string | null;
  status?: ReminderStatus;
  error?: string | null;
  updated_at?: string;
}

export interface NotificationInbox {
  id: string;
  org_id: string;
  profile_id: string;
  type: string;
  title: string;
  body: string;
  related_type: string | null;
  related_id: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface NotificationInboxInsert {
  id?: string;
  org_id: string;
  profile_id: string;
  type: string;
  title: string;
  body: string;
  related_type?: string | null;
  related_id?: string | null;
  read_at?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface NotificationInboxUpdate {
  read_at?: string | null;
  updated_at?: string;
}

// Module 4: Community & Security + AI
export type CommunityPostCategory = 'general' | 'question' | 'marketplace' | 'event';
export interface CommunityPost {
  id: string;
  org_id: string;
  author_id: string;
  title: string;
  body: string;
  category: CommunityPostCategory;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}
export interface CommunityPostInsert {
  id?: string;
  org_id: string;
  author_id: string;
  title: string;
  body: string;
  category?: CommunityPostCategory;
  pinned?: boolean;
  created_at?: string;
  updated_at?: string;
}
export interface CommunityPostUpdate {
  title?: string;
  body?: string;
  category?: CommunityPostCategory;
  pinned?: boolean;
  updated_at?: string;
}

export interface CommunityComment {
  id: string;
  org_id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}
export interface CommunityCommentInsert {
  id?: string;
  org_id: string;
  post_id: string;
  author_id: string;
  body: string;
  created_at?: string;
  updated_at?: string;
}
export interface CommunityCommentUpdate {
  body?: string;
  updated_at?: string;
}

export interface VisitorLog {
  id: string;
  org_id: string;
  property_id: string | null;
  unit_id: string | null;
  visitor_name: string;
  host_tenant_id: string | null;
  visit_date: string;
  entry_time: string | null;
  exit_time: string | null;
  purpose: string | null;
  created_by: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface VisitorLogInsert {
  id?: string;
  org_id: string;
  property_id?: string | null;
  unit_id?: string | null;
  visitor_name: string;
  host_tenant_id?: string | null;
  visit_date: string;
  entry_time?: string | null;
  exit_time?: string | null;
  purpose?: string | null;
  created_by: string;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface VisitorLogUpdate {
  exit_time?: string | null;
  notes?: string | null;
  updated_at?: string;
}

export type ChatRole = 'user' | 'assistant';
export interface AiChatMessage {
  id: string;
  org_id: string;
  profile_id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
}
export interface AiChatMessageInsert {
  id?: string;
  org_id: string;
  profile_id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  created_at?: string;
}

// Pricing tier shape (inside PricingTable.tiers jsonb)
export interface PricingTier {
  label: string;
  bedrooms: number;
  min_rent: number;
  max_rent: number;
  suggested_rent: number;
}

// =============================================================================
// W9: CSV Import tables (migration 20260603000030_imports.sql)
// =============================================================================

export type CsvImportType = 'monthly_billed' | 'monthly_collected' | 'monthly_summary' | 'room_performance';
export type CsvImportStatus = 'dry_run' | 'committed' | 'failed';

export interface CsvImport {
  id: string;
  org_id: string;
  import_type: CsvImportType;
  original_filename: string;
  period: string;                // YYYY-MM
  status: CsvImportStatus;
  row_count: number;
  failed_count: number;
  error_summary: Json;
  committed_at: string | null;
  created_by: string;
  created_at: string;
}
export interface CsvImportInsert {
  id?: string;
  org_id: string;
  import_type: CsvImportType;
  original_filename: string;
  period: string;
  status?: CsvImportStatus;
  row_count?: number;
  failed_count?: number;
  error_summary?: Json;
  committed_at?: string | null;
  created_by: string;
  created_at?: string;
}
export interface CsvImportUpdate {
  status?: CsvImportStatus;
  row_count?: number;
  failed_count?: number;
  error_summary?: Json;
  committed_at?: string | null;
}

export type ImportRowStatus = 'ok' | 'warning' | 'error';

export interface ImportRow {
  id: string;
  import_id: string;
  row_number: number;
  raw_data: Json;
  normalized_data: Json | null;
  status: ImportRowStatus;
  error_detail: string | null;
  created_at: string;
}
export interface ImportRowInsert {
  id?: string;
  import_id: string;
  row_number: number;
  raw_data: Json;
  normalized_data?: Json | null;
  status: ImportRowStatus;
  error_detail?: string | null;
  created_at?: string;
}

export type PhantomRoomResolution = 'pending' | 'mapped' | 'ignored';

export interface PhantomRoom {
  id: string;
  org_id: string;
  raw_room_label: string;
  matched_unit_id: string | null;
  resolution: PhantomRoomResolution;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}
export interface PhantomRoomInsert {
  id?: string;
  org_id: string;
  raw_room_label: string;
  matched_unit_id?: string | null;
  resolution?: PhantomRoomResolution;
  resolved_by?: string | null;
  resolved_at?: string | null;
  created_at?: string;
}
export interface PhantomRoomUpdate {
  matched_unit_id?: string | null;
  resolution?: PhantomRoomResolution;
  resolved_by?: string | null;
  resolved_at?: string | null;
}

export interface PropertyMapping {
  id: string;
  org_id: string;
  external_name: string;
  internal_property_id: string | null;
  last_matched_at: string | null;
  created_by: string | null;
}
export interface PropertyMappingInsert {
  id?: string;
  org_id: string;
  external_name: string;
  internal_property_id?: string | null;
  last_matched_at?: string | null;
  created_by?: string | null;
}
export interface PropertyMappingUpdate {
  internal_property_id?: string | null;
  last_matched_at?: string | null;
}

export interface AccountMapping {
  id: string;
  org_id: string;
  external_account: string;
  internal_category: string | null;
  is_income: boolean;
  affects_net_profit: boolean;
  created_by: string | null;
}
export interface AccountMappingInsert {
  id?: string;
  org_id: string;
  external_account: string;
  internal_category?: string | null;
  is_income?: boolean;
  affects_net_profit?: boolean;
  created_by?: string | null;
}
export interface AccountMappingUpdate {
  internal_category?: string | null;
  is_income?: boolean;
  affects_net_profit?: boolean;
}

// =============================================================================
// W1: unit_images table types (migration 000035)
// =============================================================================

export type UnitImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface UnitImage {
  id: string;
  org_id: string;
  unit_id: string;
  storage_path: string;
  filename: string;
  mime_type: UnitImageMimeType;
  size_bytes: number;
  width: number | null;
  height: number | null;
  is_cover: boolean;
  caption: string | null;
  sort_order: number;
  uploaded_by: string;
  uploaded_at: string;
}

export interface UnitImageInsert {
  id?: string;
  org_id: string;
  unit_id: string;
  storage_path: string;
  filename: string;
  mime_type: UnitImageMimeType;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  is_cover?: boolean;
  caption?: string | null;
  sort_order?: number;
  uploaded_by: string;
  uploaded_at?: string;
}

export interface UnitImageUpdate {
  storage_path?: string;
  filename?: string;
  mime_type?: UnitImageMimeType;
  size_bytes?: number;
  width?: number | null;
  height?: number | null;
  is_cover?: boolean;
  caption?: string | null;
  sort_order?: number;
  uploaded_by?: string;
  uploaded_at?: string;
}
