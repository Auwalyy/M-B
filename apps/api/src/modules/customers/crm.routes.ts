import {
  PERMISSIONS,
  createCustomerSchema,
  customerLookupQuery,
  idParams,
  interactionSchema,
  linkBranchSchema,
  listCustomersQuery,
  listEnquiriesQuery,
  publicEnquirySchema,
  segmentFilterSchema,
  segmentSchema,
  staffEnquirySchema,
  updateCustomerSchema,
  updateEnquirySchema,
  updateSegmentSchema,
} from '@mb/shared';
import type { ModuleRouter } from '../../core/http/route';
import {
  addInteraction,
  createCustomer,
  createSegment,
  deleteSegment,
  getCustomer,
  linkCustomerToBranch,
  listCustomers,
  listInteractions,
  listSegments,
  lookupCustomer,
  previewSegment,
  updateCustomer,
  updateSegment,
} from './customer.service';
import { createPublicEnquiry, createStaffEnquiry, getEnquiry, listEnquiries, updateEnquiry } from './enquiry.service';

const P = PERMISSIONS;

export function registerCustomerRoutes(m: ModuleRouter): void {
  m.route({
    method: 'get',
    path: '/',
    summary: 'Customers served by your branches (all customers for the super admin)',
    permission: P.CUSTOMERS_READ,
    query: listCustomersQuery,
    handler: ({ query, auth }) => listCustomers(auth, query),
  });
  m.route({
    method: 'get',
    path: '/lookup',
    summary: 'Find the central customer record for a phone number before registering',
    description: 'Returns the record even when another branch registered it (name only), so the same person is not registered twice.',
    permission: P.CUSTOMERS_CREATE,
    query: customerLookupQuery,
    handler: ({ query, auth }) => lookupCustomer(auth, query.phone),
  });
  m.route({ method: 'post', path: '/', summary: 'Register a walk-in, WhatsApp or phone customer', permission: P.CUSTOMERS_CREATE, body: createCustomerSchema, handler: ({ body, auth, meta }) => createCustomer(auth, body, meta) });
  m.route({ method: 'get', path: '/:id', summary: 'Customer profile', permission: P.CUSTOMERS_READ, params: idParams, handler: ({ params, auth }) => getCustomer(auth, params.id) });
  m.route({ method: 'patch', path: '/:id', summary: 'Update a customer', permission: P.CUSTOMERS_UPDATE, params: idParams, body: updateCustomerSchema, handler: ({ params, body, auth, meta }) => updateCustomer(auth, params.id, body, meta) });
  m.route({
    method: 'post',
    path: '/:id/branches',
    summary: 'Start serving an existing customer at one of your branches',
    permission: P.CUSTOMERS_CREATE,
    params: idParams,
    body: linkBranchSchema,
    status: 200,
    handler: ({ params, body, auth, meta }) => linkCustomerToBranch(auth, params.id, body.branch, meta),
  });
  m.route({ method: 'get', path: '/:id/interactions', summary: 'Communication history', permission: P.CUSTOMERS_READ, params: idParams, handler: ({ params, auth }) => listInteractions(auth, params.id) });
  m.route({
    method: 'post',
    path: '/:id/interactions',
    summary: 'Record a call, WhatsApp chat or visit',
    permission: P.CUSTOMERS_CREATE,
    params: idParams,
    body: interactionSchema,
    handler: ({ params, body, auth }) => addInteraction(auth, params.id, body),
  });
}

export function registerSegmentRoutes(m: ModuleRouter): void {
  m.route({ method: 'get', path: '/', summary: 'Saved customer segments with counts in your scope', permission: P.CUSTOMERS_READ, handler: ({ auth }) => listSegments(auth) });
  m.route({ method: 'post', path: '/preview', summary: 'Count customers matching conditions without saving', permission: P.CUSTOMERS_READ, body: segmentFilterSchema, status: 200, handler: ({ body, auth }) => previewSegment(auth, body) });
  m.route({ method: 'post', path: '/', summary: 'Save a segment', permission: P.CUSTOMERS_SEGMENTS, body: segmentSchema, handler: ({ body, auth, meta }) => createSegment(auth, body, meta) });
  m.route({ method: 'patch', path: '/:id', summary: 'Edit a segment', permission: P.CUSTOMERS_SEGMENTS, params: idParams, body: updateSegmentSchema, handler: ({ params, body, auth, meta }) => updateSegment(auth, params.id, body, meta) });
  m.route({ method: 'delete', path: '/:id', summary: 'Delete a segment', permission: P.CUSTOMERS_SEGMENTS, params: idParams, status: 204, handler: ({ params, auth, meta }) => deleteSegment(auth, params.id, meta) });
}

export function registerEnquiryRoutes(m: ModuleRouter): void {
  m.route({
    method: 'post',
    path: '/',
    summary: 'Send an enquiry from the website (rate limited)',
    auth: 'none',
    rateLimit: 'sensitive',
    body: publicEnquirySchema,
    handler: ({ body, meta }) => createPublicEnquiry(body, meta),
  });
  m.route({
    method: 'post',
    path: '/log',
    summary: 'Log an enquiry received by WhatsApp, phone or in person',
    permission: P.ENQUIRIES_MANAGE,
    body: staffEnquirySchema,
    handler: ({ body, auth, meta }) => createStaffEnquiry(auth, body, meta),
  });
  m.route({ method: 'get', path: '/', summary: 'Enquiries for your branches', permission: P.ENQUIRIES_READ, query: listEnquiriesQuery, handler: ({ query, auth }) => listEnquiries(auth, query) });
  m.route({ method: 'get', path: '/:id', summary: 'Get an enquiry', permission: P.ENQUIRIES_READ, params: idParams, handler: ({ params, auth }) => getEnquiry(auth, params.id) });
  m.route({
    method: 'patch',
    path: '/:id',
    summary: 'Update status, assign, or add a note',
    permission: P.ENQUIRIES_MANAGE,
    params: idParams,
    body: updateEnquirySchema,
    handler: ({ params, body, auth, meta }) => updateEnquiry(auth, params.id, body, meta),
  });
}
