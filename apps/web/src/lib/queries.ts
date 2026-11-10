'use client';

import type { AuditLogDto, BranchDto, RoleDto, SettingsDto, StaffDto } from '@mb/shared';
import type {
  AdjustmentDto,
  BrandDto,
  CategoryDto,
  CustomerDto,
  EnquiryDto,
  InteractionDto,
  InventoryDto,
  MovementDto,
  ProductDto,
  SegmentDto,
  TransferDto,
} from '@mb/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type Query, api } from './api';

/** Query keys in one place so mutations can invalidate precisely. */
export const keys = {
  branches: (q?: Query) => ['branches', q ?? {}] as const,
  branch: (id: string) => ['branch', id] as const,
  staff: (q?: Query) => ['staff', q ?? {}] as const,
  staffMember: (id: string) => ['staff-member', id] as const,
  roles: ['roles'] as const,
  settings: ['settings'] as const,
  audit: (kind: 'activity' | 'logins', q: Query) => ['audit', kind, q] as const,
};

/** Branches the signed-in staff member can see (all branches for the super admin). */
export function useBranches(q: Query = {}) {
  return useQuery({
    queryKey: keys.branches(q),
    queryFn: ({ signal }) => api.page<BranchDto>('/branches', { limit: 100, ...q }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useBranch(id: string) {
  return useQuery({ queryKey: keys.branch(id), queryFn: () => api.get<BranchDto>(`/branches/${id}`) });
}

export function useStaff(q: Query) {
  return useQuery({
    queryKey: keys.staff(q),
    queryFn: ({ signal }) => api.page<StaffDto>('/users', q, signal),
    placeholderData: keepPreviousData,
  });
}

export function useStaffMember(id: string) {
  return useQuery({ queryKey: keys.staffMember(id), queryFn: () => api.get<StaffDto>(`/users/${id}`) });
}

export function useRoles(enabled = true) {
  return useQuery({ queryKey: keys.roles, queryFn: () => api.get<RoleDto[]>('/roles'), enabled });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<SettingsDto>('/settings') });
}

export function useAudit(kind: 'activity' | 'logins', q: Query, enabled = true) {
  return useQuery({
    queryKey: keys.audit(kind, q),
    queryFn: ({ signal }) => api.page<AuditLogDto>(kind === 'logins' ? '/audit-logs/logins' : '/audit-logs', q, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// ------------------------------------------------------------------ Phase 2

export const keys2 = {
  categories: ['categories'] as const,
  brands: ['brands'] as const,
  products: (q: Query) => ['products', q] as const,
  product: (id: string) => ['product', id] as const,
  inventory: (q: Query) => ['inventory', q] as const,
  movements: (q: Query) => ['movements', q] as const,
  adjustments: (q: Query) => ['adjustments', q] as const,
  transfers: (q: Query) => ['transfers', q] as const,
  transfer: (id: string) => ['transfer', id] as const,
  customers: (q: Query) => ['customers', q] as const,
  customer: (id: string) => ['customer', id] as const,
  interactions: (id: string) => ['customer', id, 'interactions'] as const,
  segments: ['segments'] as const,
  enquiries: (q: Query) => ['enquiries', q] as const,
  enquiry: (id: string) => ['enquiry', id] as const,
};

/** Every active branch (public details), regardless of the user's own branches. */
export const useAllBranches = () =>
  useQuery({ queryKey: ['branches', 'public'], queryFn: () => api.get<{ id: string; name: string; code: string }[]>('/branches', { view: 'public', limit: 100 }), staleTime: 5 * 60_000 });

export const useCategories = () => useQuery({ queryKey: keys2.categories, queryFn: () => api.get<CategoryDto[]>('/categories') });
export const useBrands = () => useQuery({ queryKey: keys2.brands, queryFn: () => api.get<BrandDto[]>('/brands') });

export const useProducts = (q: Query, enabled = true) =>
  useQuery({ queryKey: keys2.products(q), queryFn: ({ signal }) => api.page<ProductDto>('/products', q, signal), placeholderData: keepPreviousData, enabled });
export const useProduct = (id: string) => useQuery({ queryKey: keys2.product(id), queryFn: () => api.get<ProductDto>(`/products/${id}`) });

export const useInventory = (q: Query, enabled = true) =>
  useQuery({ queryKey: keys2.inventory(q), queryFn: ({ signal }) => api.page<InventoryDto>('/inventory', q, signal), placeholderData: keepPreviousData, enabled });
export const useMovements = (q: Query) =>
  useQuery({ queryKey: keys2.movements(q), queryFn: ({ signal }) => api.page<MovementDto>('/inventory/movements', q, signal), placeholderData: keepPreviousData });
export const useAdjustments = (q: Query) =>
  useQuery({ queryKey: keys2.adjustments(q), queryFn: ({ signal }) => api.page<AdjustmentDto>('/inventory/adjustments', q, signal), placeholderData: keepPreviousData });
export const useTransfers = (q: Query) =>
  useQuery({ queryKey: keys2.transfers(q), queryFn: ({ signal }) => api.page<TransferDto>('/inventory/transfers', q, signal), placeholderData: keepPreviousData });
export const useTransfer = (id: string) => useQuery({ queryKey: keys2.transfer(id), queryFn: () => api.get<TransferDto>(`/inventory/transfers/${id}`) });

export const useCustomers = (q: Query) =>
  useQuery({ queryKey: keys2.customers(q), queryFn: ({ signal }) => api.page<CustomerDto>('/customers', q, signal), placeholderData: keepPreviousData });
export const useCustomer = (id: string) => useQuery({ queryKey: keys2.customer(id), queryFn: () => api.get<CustomerDto>(`/customers/${id}`) });
export const useInteractions = (id: string) => useQuery({ queryKey: keys2.interactions(id), queryFn: () => api.get<InteractionDto[]>(`/customers/${id}/interactions`) });
export const useSegments = (enabled = true) => useQuery({ queryKey: keys2.segments, queryFn: () => api.get<SegmentDto[]>('/customer-segments'), enabled });

export const useEnquiries = (q: Query) =>
  useQuery({ queryKey: keys2.enquiries(q), queryFn: ({ signal }) => api.page<EnquiryDto>('/enquiries', q, signal), placeholderData: keepPreviousData });
export const useEnquiry = (id: string) => useQuery({ queryKey: keys2.enquiry(id), queryFn: () => api.get<EnquiryDto>(`/enquiries/${id}`) });
