import type { MailMessage } from './mailer';

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f2;font-family:Segoe UI,Arial,sans-serif;color:#1c2421">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0f4c3a;color:#ffffff;padding:20px 28px;font-size:18px;font-weight:600">Mudassir &amp; Brothers</td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:20px;margin:0 0 16px">${escape(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px;background:#f8f9f6;color:#66706b;font-size:12px">This is an automated message from Mudassir &amp; Brothers. Please do not reply to this email.</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${escape(href)}" style="background:#0f4c3a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${escape(label)}</a></p>`;

export function passwordResetEmail(to: string, name: string, link: string, expiresInMinutes: number): MailMessage {
  return {
    to,
    subject: 'Reset your Mudassir & Brothers password',
    html: layout(
      'Reset your password',
      `<p>Hello ${escape(name)},</p>
<p>We received a request to reset your password. Use the button below to choose a new one. The link expires in ${expiresInMinutes} minutes.</p>
${button(link, 'Reset password')}
<p style="color:#66706b;font-size:13px">If you did not ask for this, you can ignore this email. Your password will not change.</p>`,
    ),
    text: `Hello ${name},\n\nReset your password using this link (valid for ${expiresInMinutes} minutes):\n${link}\n\nIf you did not ask for this, ignore this email.`,
  };
}

export function passwordChangedEmail(to: string, name: string): MailMessage {
  return {
    to,
    subject: 'Your Mudassir & Brothers password was changed',
    html: layout(
      'Your password was changed',
      `<p>Hello ${escape(name)},</p><p>The password for your account was just changed and every other device was signed out.</p>
<p>If this was not you, contact Mudassir &amp; Brothers support immediately.</p>`,
    ),
    text: `Hello ${name},\n\nThe password for your account was just changed. If this was not you, contact support immediately.`,
  };
}

export function lowStockEmail(
  to: string,
  name: string,
  d: { product: string; sku: string; branch: string; available: number; reorderLevel: number; link: string },
): MailMessage {
  const state = d.available <= 0 ? 'is out of stock' : `is running low (${d.available} left)`;
  return {
    to,
    subject: `Low stock: ${d.product} at ${d.branch}`,
    html: layout(
      'Low stock alert',
      `<p>Hello ${escape(name)},</p>
<p><strong>${escape(d.product)}</strong> (SKU ${escape(d.sku)}) at <strong>${escape(d.branch)}</strong> ${escape(state)}. The reorder level is ${d.reorderLevel}.</p>
${button(d.link, 'View low-stock items')}`,
    ),
    text: `Hello ${name},\n\n${d.product} (SKU ${d.sku}) at ${d.branch} ${state}. Reorder level: ${d.reorderLevel}.\n\n${d.link}`,
  };
}

export function newEnquiryEmail(
  to: string,
  name: string,
  d: { reference: string; branch: string; channel: string; name: string; subject: string; link: string },
): MailMessage {
  return {
    to,
    subject: `New enquiry ${d.reference} at ${d.branch}`,
    html: layout(
      'New customer enquiry',
      `<p>Hello ${escape(name)},</p>
<p><strong>${escape(d.name)}</strong> sent an enquiry by ${escape(d.channel)}: “${escape(d.subject)}”.</p>
${button(d.link, 'Open the enquiry')}`,
    ),
    text: `Hello ${name},\n\n${d.name} sent an enquiry by ${d.channel}: "${d.subject}" (${d.reference}).\n\n${d.link}`,
  };
}

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

export function orderPlacedEmail(
  to: string,
  name: string,
  d: { reference: string; branch: string; total: number; fulfilment: 'pickup' | 'delivery'; link: string },
): MailMessage {
  const next = d.fulfilment === 'pickup' ? `${d.branch} will let you know when it is ready for pickup.` : `${d.branch} will contact you to arrange delivery.`;
  return {
    to,
    subject: `Order ${d.reference} received`,
    html: layout(
      'Thank you for your order',
      `<p>Hello ${escape(name)},</p>
<p>We have received your order <strong>${escape(d.reference)}</strong> for <strong>${naira(d.total)}</strong>. ${escape(next)}</p>
${button(d.link, 'Track your order')}
<p style="color:#66706b;font-size:13px">Keep your order number handy. You will need it with your phone number to track the order.</p>`,
    ),
    text: `Hello ${name},\n\nWe have received your order ${d.reference} for ${naira(d.total)}. ${next}\n\nTrack it: ${d.link}`,
  };
}

export function newOrderStaffEmail(
  to: string,
  name: string,
  d: { reference: string; branch: string; customer: string; total: number; fulfilment: 'pickup' | 'delivery'; link: string },
): MailMessage {
  return {
    to,
    subject: `New online order ${d.reference} (${naira(d.total)})`,
    html: layout(
      'New online order',
      `<p>Hello ${escape(name)},</p>
<p><strong>${escape(d.customer)}</strong> placed order <strong>${escape(d.reference)}</strong> at ${escape(d.branch)} for ${naira(d.total)} (${d.fulfilment === 'pickup' ? 'branch pickup' : 'home delivery'}). The items are held in stock for this order.</p>
${button(d.link, 'Open the order')}`,
    ),
    text: `Hello ${name},\n\n${d.customer} placed order ${d.reference} at ${d.branch} for ${naira(d.total)} (${d.fulfilment}).\n\n${d.link}`,
  };
}

/** Generic notification email: a title, a sentence or two, and an optional button. */
export function simpleEmail(to: string, name: string, title: string, body: string, link: string | null): MailMessage {
  return {
    to,
    subject: title,
    html: layout(title, `<p>Hello ${escape(name)},</p><p>${escape(body)}</p>${link ? button(link, 'View details') : ''}`),
    text: `Hello ${name},\n\n${body}${link ? `\n\n${link}` : ''}`,
  };
}

export function staffWelcomeEmail(to: string, name: string, roleName: string, loginUrl: string): MailMessage {
  return {
    to,
    subject: 'Your Mudassir & Brothers staff account',
    html: layout(
      'Welcome to the team',
      `<p>Hello ${escape(name)},</p><p>A ${escape(roleName)} account has been created for you. Your administrator will give you a temporary password. You will be asked to choose your own password when you first sign in.</p>
${button(loginUrl, 'Sign in')}`,
    ),
    text: `Hello ${name},\n\nA ${roleName} account has been created for you. Sign in at ${loginUrl} using the temporary password from your administrator.`,
  };
}
