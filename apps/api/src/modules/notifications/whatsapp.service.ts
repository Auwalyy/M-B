import { toWhatsAppNumber } from '@mb/shared';
import { Types } from 'mongoose';
import { badRequest, notFound } from '../../core/errors/AppError';
import { Branch } from '../branches/branch.model';
import { Product } from '../catalog/catalog.models';
import { Order } from '../commerce/commerce.models';
import { getSettingsDoc } from '../settings/settings.service';
import { Reservation } from '../transactions/transactions.models';
import { WhatsAppClick } from './notification.models';

export type WhatsAppContext = 'product' | 'order' | 'reservation' | 'branch';

/**
 * Builds a wa.me link with a pre-filled message for the right branch number.
 * Opening the link does not send anything: the customer still presses send in WhatsApp.
 */
export async function buildWhatsAppLink(context: WhatsAppContext, ref: string | undefined, branchId: string | undefined): Promise<{ url: string; message: string; number: string }> {
  const settings = await getSettingsDoc();
  const branch = branchId && Types.ObjectId.isValid(branchId) ? await Branch.findOne({ _id: branchId, status: 'active' }).select('name whatsapp').lean() : null;
  const company = settings.companyName;
  let message: string;
  switch (context) {
    case 'product': {
      const p = ref ? await Product.findOne({ slug: ref, status: 'active' }).select('name sku').lean() : null;
      if (!p) throw notFound('Product');
      message = `Hello ${company}, I am interested in ${p.name}, Product SKU: ${p.sku}. Please confirm its availability and price${branch ? ` at your ${branch.name} branch` : ''}.`;
      break;
    }
    case 'order': {
      if (!ref || !(await Order.exists({ reference: ref }))) throw notFound('Order');
      message = `Hello ${company}, I am asking about my order ${ref}.`;
      break;
    }
    case 'reservation': {
      if (!ref || !(await Reservation.exists({ reference: ref }))) throw notFound('Reservation');
      message = `Hello ${company}, I am asking about my reservation ${ref}.`;
      break;
    }
    case 'branch':
      if (!branch) throw badRequest('Choose a branch.');
      message = `Hello ${company}, I have an enquiry for your ${branch.name} branch.`;
      break;
  }
  const number = toWhatsAppNumber(branch?.whatsapp ?? settings.whatsapp);
  return { url: `https://wa.me/${number}?text=${encodeURIComponent(message)}`, message, number };
}

/** Records that a visitor opened a WhatsApp link (intent only; nothing is sent or delivered by us). */
export async function recordWhatsAppClick(context: string, ref: string | undefined, branch: string | undefined): Promise<void> {
  await WhatsAppClick.create({ context, ref: ref ?? null, branch: branch && Types.ObjectId.isValid(branch) ? branch : null });
}
