// Motor de relevância: pontua cada mensagem recebida para que o CS
// responda primeiro o que realmente importa.

const RULES = [
  { pts: 30, label: 'Intenção de compra', re: /\b(orçament\w*|proposta|contrat\w*|fechar|comprar|adquirir|plano|assinatura|upgrade|investi\w*)\b/i },
  { pts: 28, label: 'Risco de churn', re: /\b(cancelar|cancelamento|encerrar|sair|reembolso|estorno|insatisfeit\w*|decepcionad\w*|reclamaç\w*|procon)\b/i },
  { pts: 24, label: 'Problema técnico', re: /\b(erro|bug|falha|travou|travando|fora do ar|não funciona|nao funciona|instáve\w*|lentidão|parou)\b/i },
  { pts: 20, label: 'Urgência declarada', re: /\b(urgent\w*|hoje|agora|imediat\w*|prazo|atrasad\w*|emergência|asap)\b/i },
  { pts: 16, label: 'Financeiro', re: /\b(boleto|fatura|pagamento|nota fiscal|nf-?e|cobrança|preço|valor|desconto)\b/i },
  { pts: 12, label: 'Pergunta direta', re: /\?|\b(como|quando|quanto|onde|pode|poderia|consegue|dúvida|duvida)\b/i },
  { pts: 10, label: 'Reunião / agenda', re: /\b(reunião|reuniao|call|agendar|demonstração|demo|apresentação)\b/i },
  { pts: -25, label: 'Automático / spam', re: /\b(no-?reply|newsletter|promoç\w*|unsubscribe|descadastr\w*|marketing digital|parceria de divulgação|sorteio|curso grátis)\b/i },
  { pts: -12, label: 'Somente agradecimento', re: /^\s*(ok|obrigad\w*|valeu|blz|beleza|show|perfeito|👍|🙏|legal)[\s!.]*$/i }
];

const CHANNEL_WEIGHT = {
  whatsapp: 10, telefone: 12, email: 6, instagram: 4, site: 8, chat: 8, outro: 0
};

const TRIAGE_TARGET_HOURS = { alta: 2, media: 8, baixa: 24 };

export function scoreMessage({ body = '', subject = '', channel = 'outro', isCustomer = false, receivedAt = null }) {
  const text = `${subject}\n${body}`;
  let score = 0;
  const reasons = [];

  for (const rule of RULES) {
    if (rule.re.test(text)) {
      score += rule.pts;
      reasons.push(`${rule.pts > 0 ? '+' : ''}${rule.pts} ${rule.label}`);
    }
  }

  const channelPts = CHANNEL_WEIGHT[channel] ?? 0;
  if (channelPts) {
    score += channelPts;
    reasons.push(`+${channelPts} Canal ${channel}`);
  }

  if (isCustomer) {
    score += 15;
    reasons.push('+15 Cliente ativo');
  }

  if (body.trim().length < 15) {
    score -= 8;
    reasons.push('-8 Mensagem muito curta');
  }

  if (receivedAt) {
    const hours = (Date.now() - new Date(`${receivedAt.replace(' ', 'T')}Z`).getTime()) / 3.6e6;
    if (hours >= 24) {
      score += 12;
      reasons.push('+12 Esperando há mais de 24h');
    } else if (hours >= 8) {
      score += 6;
      reasons.push('+6 Esperando há mais de 8h');
    }
  }

  score = Math.max(0, Math.min(100, score));
  const priority = score >= 55 ? 'alta' : score >= 30 ? 'media' : 'baixa';

  return { score, priority, reasons: reasons.join(' · ') };
}

export function dueDateFor(priority, receivedAt) {
  const base = receivedAt
    ? new Date(`${receivedAt.replace(' ', 'T')}Z`)
    : new Date();
  const hours = TRIAGE_TARGET_HOURS[priority] ?? 24;
  return new Date(base.getTime() + hours * 3.6e6).toISOString().slice(0, 19).replace('T', ' ');
}
