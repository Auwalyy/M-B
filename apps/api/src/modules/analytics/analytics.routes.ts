import {
  PERMISSIONS,
  analyticsRangeQuery,
  branchOnlyQuery,
  customersReportQuery,
  idParams,
  inventoryReportQuery,
  paymentsReportQuery,
  salesReportQuery,
  salesSeriesQuery,
  topProductsQuery,
} from '@mb/shared';
import type { ModuleRouter } from '../../core/http/route';
import { branchPerformance, lowStock, overview, recentTransactions, salesSeries, topProducts } from './analytics.service';
import { customersReport, inventoryReport, paymentsReport, salesReport } from './reports.service';

const P = PERMISSIONS;

/**
 * Every route is scoped to the caller's branches. Asking for a branch outside that scope
 * answers 404. Financial figures need reports:financial for every branch shown.
 */
export function registerAnalyticsRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/overview',
    summary: 'Headline figures for the company, your branches, or one branch',
    description: 'Gross sales, orders, average order, units sold, collected revenue, refunds, outstanding balance, inventory value, stock alerts and work waiting. Range figures come with the previous period of the same length.',
    permission: P.REPORTS_READ,
    query: analyticsRangeQuery,
    handler: ({ query, auth }) => overview(auth, query),
  });
  m.route({
    method: 'get',
    path: '/branch/:id/overview',
    summary: 'Headline figures for one branch',
    permission: P.REPORTS_READ,
    params: idParams,
    query: analyticsRangeQuery,
    handler: ({ params, query, auth }) => overview(auth, { ...query, branch: params.id }),
  });
  m.route({
    method: 'get',
    path: '/branches/performance',
    summary: 'Compare branches side by side',
    permission: P.REPORTS_READ,
    query: analyticsRangeQuery,
    handler: ({ query, auth }) => branchPerformance(auth, query),
  });
  m.route({
    method: 'get',
    path: '/sales',
    summary: 'Gross sales and collected revenue by day, week or month',
    permission: P.REPORTS_READ,
    query: salesSeriesQuery,
    handler: ({ query, auth }) => salesSeries(auth, query),
  });
  m.route({
    method: 'get',
    path: '/top-products',
    summary: 'Best sellers on completed orders',
    permission: P.REPORTS_READ,
    query: topProductsQuery,
    handler: ({ query, auth }) => topProducts(auth, query),
  });
  m.route({
    method: 'get',
    path: '/low-stock',
    summary: 'Stock lines at or below their reorder level',
    permission: P.REPORTS_READ,
    query: branchOnlyQuery,
    handler: ({ query, auth }) => lowStock(auth, query),
  });
  m.route({
    method: 'get',
    path: '/recent-transactions',
    summary: 'Latest orders and verified payments',
    permission: P.REPORTS_READ,
    query: branchOnlyQuery,
    handler: ({ query, auth }) => recentTransactions(auth, query),
  });
}

export function registerReportRoutes(m: ModuleRouter): void {
  const csvNote = 'Add format=csv to download every row (up to 50,000) as a spreadsheet. Downloads are recorded in the activity log.';
  m.route({
    method: 'get',
    path: '/sales',
    summary: 'Sales report: accepted orders confirmed in the range',
    description: csvNote,
    permission: P.REPORTS_READ,
    query: salesReportQuery,
    handler: ({ query, auth, res, meta }) => salesReport(auth, query, { res, meta }),
  });
  m.route({
    method: 'get',
    path: '/inventory',
    summary: 'Inventory report: stock on hand, value and alerts',
    description: `${csvNote} Cost columns need inventory cost access.`,
    permission: P.REPORTS_READ,
    query: inventoryReportQuery,
    handler: ({ query, auth, res, meta }) => inventoryReport(auth, query, { res, meta }),
  });
  m.route({
    method: 'get',
    path: '/customers',
    summary: 'Customer report: who bought in the range and how much',
    description: csvNote,
    permission: P.REPORTS_READ,
    query: customersReportQuery,
    handler: ({ query, auth, res, meta }) => customersReport(auth, query, { res, meta }),
  });
  m.route({
    method: 'get',
    path: '/payments',
    summary: 'Payment report: verified payments and refunds',
    description: csvNote,
    permission: P.REPORTS_FINANCIAL,
    query: paymentsReportQuery,
    handler: ({ query, auth, res, meta }) => paymentsReport(auth, query, { res, meta }),
  });
}
