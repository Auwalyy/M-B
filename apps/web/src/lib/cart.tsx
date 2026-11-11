'use client';

import type { CartDto } from '@mb/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react';
import { api } from './api';
import { useAuth } from './auth';

interface CartApi {
  cart: CartDto | undefined;
  loading: boolean;
  setItem: (product: string, variantId: string | null, quantity: number) => Promise<CartDto>;
  setBranch: (branch: string) => Promise<CartDto>;
  busy: boolean;
}

const CartContext = createContext<CartApi | null>(null);
export const CART_KEY = ['cart'] as const;

/**
 * The cart lives on the server (a cookie identifies guests), so prices and stock are always current.
 * When a guest signs in, their cart is merged into the account.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const qc = useQueryClient();
  const merged = useRef(false);
  const cart = useQuery({ queryKey: CART_KEY, queryFn: () => api.get<CartDto>('/cart'), enabled: status !== 'loading', staleTime: 15_000 });

  useEffect(() => {
    if (status === 'authenticated' && !merged.current) {
      merged.current = true;
      void api.post<CartDto>('/cart/merge').then((c) => qc.setQueryData(CART_KEY, c)).catch(() => undefined);
    }
    if (status === 'anonymous') merged.current = false;
  }, [status, qc]);

  const item = useMutation({
    mutationFn: (v: { product: string; variantId: string | null; quantity: number }) => api.put<CartDto>('/cart/items', v),
    onSuccess: (c) => qc.setQueryData(CART_KEY, c),
  });
  const branch = useMutation({
    mutationFn: (b: string) => api.put<CartDto>('/cart/branch', { branch: b }),
    onSuccess: (c) => qc.setQueryData(CART_KEY, c),
  });

  const value: CartApi = {
    cart: cart.data,
    loading: cart.isLoading,
    setItem: (product, variantId, quantity) => item.mutateAsync({ product, variantId, quantity }),
    setBranch: (b) => branch.mutateAsync(b),
    busy: item.isPending || branch.isPending,
  };
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
