/**
 * 1stOne F1 — useVendors
 *
 * Admin-side vendor management. Every privileged write goes through a
 * SECURITY DEFINER RPC rather than a direct table update: `vendors` has
 * UPDATE revoked from `authenticated` except for the vendor's own business
 * details, so commission, selling model, supply mode and status can only
 * move through admin_set_vendor_* — the same pattern that keeps
 * profiles.role behind elevate_to_staff.
 *
 * Onboarding elevates an EXISTING registered user; it never creates a
 * login. Finding that person by phone reuses useCustomerByPhone from
 * useAdminOrderEntry, and registering a new one reuses the back-office
 * customer screen.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../api/supabaseClient';
import { QUERY_STALE_TIME } from '../utils/constants';

export type VendorStatus = 'invited' | 'submitted' | 'approved' | 'suspended' | 'rejected';
export type SellingModel = 'own_brand' | 'house_brand';
export type SupplyMode = 'at_hub' | 'we_collect' | 'they_drop';

export interface Vendor {
  id: number;
  owner_user_id: string;
  branch_id: number | null;
  business_name: string | null;
  contact_phone: string | null;
  gst_number: string | null;
  fssai_number: string | null;
  selling_model: SellingModel;
  supply_mode: SupplyMode;
  commission_percent: number;
  status: VendorStatus;
  return_policy: string | null;
  terms_accepted_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  admin_note: string | null;
  created_at: string;
  /** Joined owner profile — who this vendor actually is. */
  profiles?: { full_name: string | null; phone_number: string | null } | null;
}

export const STATUS_LABEL: Record<VendorStatus, string> = {
  invited: 'Awaiting their details',
  submitted: 'Ready to verify',
  approved: 'Approved',
  suspended: 'Suspended',
  rejected: 'Rejected',
};

export const SELLING_MODEL_LABEL: Record<SellingModel, string> = {
  own_brand: 'Own brand — they sell, you take commission',
  house_brand: 'House brand — you buy at an agreed rate',
};

export const SUPPLY_MODE_LABEL: Record<SupplyMode, string> = {
  at_hub: 'Already at the hub',
  we_collect: 'We collect from them',
  they_drop: 'They drop to us',
};

/** All vendors, newest first. Optionally narrowed to one status. */
export function useVendors(status?: VendorStatus | 'all') {
  return useQuery({
    queryKey: ['admin_vendors', status ?? 'all'],
    queryFn: async (): Promise<Vendor[]> => {
      let q = supabase
        .from('vendors')
        .select('*, profiles!vendors_owner_profile_fkey(full_name, phone_number)')
        .order('created_at', { ascending: false });
      if (status && status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Vendor[];
    },
    staleTime: QUERY_STALE_TIME,
  });
}

export function useVendor(vendorId?: number) {
  return useQuery({
    queryKey: ['admin_vendor', vendorId ?? 'none'],
    queryFn: async (): Promise<Vendor | null> => {
      const { data, error } = await supabase
        .from('vendors')
        .select('*, profiles!vendors_owner_profile_fkey(full_name, phone_number)')
        .eq('id', vendorId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as unknown as Vendor) ?? null;
    },
    enabled: vendorId != null,
  });
}

export interface VendorZone {
  id: number;
  vendor_id: number;
  zone_id: number | null;
  hub_id: number | null;
  delivery_zones?: { zone_name: string } | null;
  delivery_hubs?: { hub_name: string } | null;
}

/** Where this vendor is allowed to sell. Admin-granted, not self-service. */
export function useVendorZones(vendorId?: number) {
  return useQuery({
    queryKey: ['admin_vendor_zones', vendorId ?? 'none'],
    queryFn: async (): Promise<VendorZone[]> => {
      const { data, error } = await supabase
        .from('vendor_zones')
        .select('*, delivery_zones(zone_name), delivery_hubs(hub_name)')
        .eq('vendor_id', vendorId!);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as VendorZone[];
    },
    enabled: vendorId != null,
  });
}

const invalidateVendor = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['admin_vendors'] });
  qc.invalidateQueries({ queryKey: ['admin_vendor'] });
  qc.invalidateQueries({ queryKey: ['admin_vendor_zones'] });
};

/** Elevate a registered user to an invited vendor. */
export function useOnboardVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      userId: string;
      businessName: string;
      contactPhone?: string;
      sellingModel: SellingModel;
      supplyMode: SupplyMode;
      commissionPercent: number;
    }) => {
      const { data, error } = await supabase.rpc('admin_onboard_vendor', {
        p_user_id: p.userId,
        p_business_name: p.businessName,
        p_contact_phone: p.contactPhone ?? undefined,
        p_selling_model: p.sellingModel,
        p_supply_mode: p.supplyMode,
        p_commission_percent: p.commissionPercent,
        p_branch_id: undefined,
      });
      if (error) throw new Error(error.message);
      return data as number;
    },
    onSuccess: () => invalidateVendor(qc),
  });
}

/** Approve, reject or suspend. Suspending takes their catalogue down. */
export function useSetVendorStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { vendorId: number; status: VendorStatus; note?: string }) => {
      const { error } = await supabase.rpc('admin_set_vendor_status', {
        p_vendor_id: p.vendorId,
        p_status: p.status,
        p_note: p.note ?? undefined,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateVendor(qc),
  });
}

/** The negotiated terms — commission, selling model, supply mode, returns. */
export function useSetVendorTerms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      vendorId: number;
      commissionPercent?: number;
      sellingModel?: SellingModel;
      supplyMode?: SupplyMode;
      returnPolicy?: string;
    }) => {
      const { error } = await supabase.rpc('admin_set_vendor_terms', {
        p_vendor_id: p.vendorId,
        p_commission_percent: p.commissionPercent ?? undefined,
        p_selling_model: p.sellingModel ?? undefined,
        p_supply_mode: p.supplyMode ?? undefined,
        p_return_policy: p.returnPolicy ?? undefined,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateVendor(qc),
  });
}

/** Grant or revoke a selling area. Written by admins only, by policy. */
export function useSetVendorZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      vendorId: number;
      zoneId?: number | null;
      hubId?: number | null;
      remove?: boolean;
    }) => {
      if (p.remove) {
        let q = supabase.from('vendor_zones').delete().eq('vendor_id', p.vendorId);
        q = p.hubId != null ? q.eq('hub_id', p.hubId) : q.eq('zone_id', p.zoneId!);
        const { error } = await q;
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await supabase.from('vendor_zones').insert({
        vendor_id: p.vendorId,
        zone_id: p.zoneId ?? null,
        hub_id: p.hubId ?? null,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateVendor(qc),
  });
}
