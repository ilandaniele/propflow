export type { Database } from './database';

// Convenience type aliases
export type Organization = import('./database').Database['public']['Tables']['organizations']['Row'];
export type Profile = import('./database').Database['public']['Tables']['profiles']['Row'];
export type Property = import('./database').Database['public']['Tables']['properties']['Row'];
export type Unit = import('./database').Database['public']['Tables']['units']['Row'];
export type Tenant = import('./database').Database['public']['Tables']['tenants']['Row'];
export type Contract = import('./database').Database['public']['Tables']['contracts']['Row'];
export type Charge = import('./database').Database['public']['Tables']['charges']['Row'];
export type Payment = import('./database').Database['public']['Tables']['payments']['Row'];
export type Incident = import('./database').Database['public']['Tables']['incidents']['Row'];
export type IncidentComment = import('./database').Database['public']['Tables']['incident_comments']['Row'];

export type UserRole = 'admin' | 'tenant';
export type IncidentStatus = 'pending' | 'in_progress' | 'solved';
export type IncidentPriority = 'low' | 'medium' | 'high' | 'urgent';
export type IncidentCategory = 'plumbing' | 'electrical' | 'appliance' | 'structural' | 'cleaning' | 'other';
export type ContractStatus = 'active' | 'expired' | 'terminated';
export type PaymentStatus = 'pending' | 'approved';
export type PaymentMethod = 'cash' | 'transfer' | 'card' | 'other';
export type UnitStatus = 'vacant' | 'occupied';
