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
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          org_id?: string;
          role?: 'admin' | 'tenant';
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
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
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          label?: string;
          floor?: string | null;
          bedrooms?: number | null;
          monthly_rent_default?: number | null;
          status?: 'vacant' | 'occupied';
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
