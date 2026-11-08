// Email text (JP keigo / EN) + sharing files to the Outlook app.
import { invoiceTotals, yen, fmtDate } from './calc.js?v=1.8.0';

export function emailFor(inv, data, kind = 'invoice') {
  const lang = inv.lang === 'en' ? 'en' : 'ja';
  const p = data.profile;
  const c = data.clients.find((x) => x.id === inv.clientId) || {};
  const t = invoiceTotals(inv, data);
  const nReceipts = t.receipts.filter((r) => r.hasFile).length;
  const proj = inv.project || inv.position || '';
  const to = c.emails || '';

  if (lang === 'ja') {
    const name = c.nameJa || c.nameEn || '';
    const hon = c.honorific || '御中';
    const greet = [`${name} ${hon}`, c.contact ? `${c.contact} 様` : ''].filter(Boolean).join('\n');
    const sig = `${p.signatureJa}\n${p.phone}\n${p.email}`;
    if (kind === 'reminder') {
      return {
        to, subject: `【ご確認】請求書 ${inv.number}${proj ? ' ' + proj : ''} のお支払いについて`,
        body: `${greet}\n\nいつもお世話になっております。\n${p.signatureJa}です。\n\n${fmtDate(inv.issueDate, 'ja')}にお送りいたしました請求書（請求書番号：${inv.number}）につきまして、お支払期限の${fmtDate(inv.dueDate, 'ja')}を過ぎておりましたので、念のためご連絡いたしました。\n\nご請求金額：${yen(t.owed)}\n\n行き違いでお手続き済みの場合は、何卒ご容赦ください。\n念のため請求書を再度添付いたします。\n\nどうぞよろしくお願いいたします。\n\n${sig}`,
      };
    }
    return {
      to, subject: `【請求書】${inv.number}${proj ? ' ' + proj : ''} / ${p.signatureEn}`,
      body: `${greet}\n\nいつもお世話になっております。\n${p.signatureJa}です。\n\n${proj ? proj + 'の' : ''}請求書（請求書番号：${inv.number}）を添付にてお送りいたします。${nReceipts ? `\n立替金の領収書（${nReceipts}点）も併せて添付しております。` : ''}\n\nご請求金額：${yen(t.total)}\nお支払期限：${fmtDate(inv.dueDate, 'ja')}\n\nご確認のほど、よろしくお願いいたします。\nご不明な点がございましたら、お気軽にご連絡ください。\n\n${sig}`,
    };
  }

  const first = c.contact ? c.contact.split(' ')[0] : '';
  const greet = first ? `Hi ${first},` : 'Hello,';
  const sig = `Best regards,\n${p.signatureEn}\n${p.phone}\n${p.email}`;
  if (kind === 'reminder') {
    return {
      to, subject: `Reminder: Invoice ${inv.number}${proj ? ' - ' + proj : ''}`,
      body: `${greet}\n\nJust a friendly reminder that invoice ${inv.number} (sent ${fmtDate(inv.issueDate, 'en')}) was due on ${fmtDate(inv.dueDate, 'en')}.\n\nAmount due: ${yen(t.owed)}\n\nIf you've already sent the payment, please ignore this. I've attached the invoice again for convenience.\n\n${sig}`,
    };
  }
  return {
    to, subject: `Invoice ${inv.number}${proj ? ' - ' + proj : ''} - ${p.signatureEn}`,
    body: `${greet}\n\nPlease find attached my invoice ${inv.number}${proj ? ` for ${proj}` : ''}.${nReceipts ? `\nI've also attached ${nReceipts === 1 ? 'the receipt' : `${nReceipts} receipts`} for the reimbursed expenses.` : ''}\n\nAmount due: ${yen(t.total)}\nDue date: ${fmtDate(inv.dueDate, 'en')}\n\nPlease let me know if you have any questions.\n\n${sig}`,
  };
}

export function canShareFiles(files) {
  try { return !!(navigator.canShare && navigator.canShare({ files })); } catch { return false; }
}

/** Must be called directly from a tap. */
export async function shareFiles(files, mail) {
  await navigator.share({ files, title: mail.subject, text: mail.body });
}

export function downloadFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function mailtoLink(mail) {
  return `mailto:${encodeURIComponent(mail.to.split(',')[0]?.trim() || '')}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
}
