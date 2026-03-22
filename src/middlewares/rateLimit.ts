import rateLimit from 'express-rate-limit';

/**
 * Rate limiter geral para API
 * 100 requests por minuto por IP
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100,
  message: { 
    error: 'Muitas requisicoes. Tente novamente em alguns instantes.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para rotas de autenticacao
 * 10 tentativas por 15 minutos por IP
 * Previne brute force em login
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  message: { 
    error: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    retryAfter: 900
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Nao conta requisicoes bem sucedidas
});

/**
 * Rate limiter para rotas de pagamento
 * 5 tentativas por minuto por IP
 * Previne abuso no processamento de pagamentos
 */
export const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5,
  message: { 
    error: 'Muitas tentativas de pagamento. Aguarde um momento.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para criacao de pedidos
 * 10 pedidos por hora por IP
 */
export const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  message: { 
    error: 'Limite de pedidos atingido. Tente novamente mais tarde.',
    retryAfter: 3600
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para busca
 * 30 buscas por minuto por IP
 */
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 30,
  message: { 
    error: 'Muitas buscas realizadas. Aguarde um momento.',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter para webhooks (mais permissivo)
 * 100 requests por minuto
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100,
  message: { error: 'Rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});
