import NodeCache from 'node-cache';

// Cache em memoria com TTL (Time To Live)
// stdTTL: tempo padrao em segundos
// checkperiod: intervalo para limpar itens expirados
const cache = new NodeCache({ 
  stdTTL: 300, // 5 minutos padrao
  checkperiod: 60, // verifica a cada 1 minuto
  useClones: false // melhor performance, nao clona objetos
});

// Chaves de cache
export const CACHE_KEYS = {
  CATEGORIES: 'categories',
  PRODUCTS_LIST: 'products_list',
  PRODUCTS_FEATURED: 'products_featured',
  BANNERS_ACTIVE: 'banners_active',
  PRODUCT_BY_SLUG: (slug: string) => `product_${slug}`,
  PRODUCTS_BY_CATEGORY: (category: string) => `products_category_${category}`,
};

// TTLs especificos (em segundos)
export const CACHE_TTL = {
  CATEGORIES: 600,      // 10 minutos - categorias mudam raramente
  PRODUCTS: 300,        // 5 minutos - produtos podem mudar
  BANNERS: 600,         // 10 minutos - banners mudam raramente
  PRODUCT_DETAIL: 180,  // 3 minutos - detalhes do produto
};

/**
 * Busca item do cache ou executa funcao e armazena resultado
 */
export async function getOrSet<T>(
  key: string, 
  fetchFn: () => Promise<T>, 
  ttl?: number
): Promise<T> {
  // Tenta buscar do cache
  const cached = cache.get<T>(key);
  if (cached !== undefined) {
    console.log(`[Cache] HIT: ${key}`);
    return cached;
  }

  // Nao encontrou, busca dados frescos
  console.log(`[Cache] MISS: ${key}`);
  const data = await fetchFn();
  
  // Armazena no cache
  if (ttl) {
    cache.set(key, data, ttl);
  } else {
    cache.set(key, data);
  }
  
  return data;
}

/**
 * Invalida uma chave especifica do cache
 */
export function invalidate(key: string): void {
  cache.del(key);
  console.log(`[Cache] INVALIDATED: ${key}`);
}

/**
 * Invalida multiplas chaves que comecam com um prefixo
 */
export function invalidateByPrefix(prefix: string): void {
  const keys = cache.keys();
  const toDelete = keys.filter(key => key.startsWith(prefix));
  toDelete.forEach(key => cache.del(key));
  console.log(`[Cache] INVALIDATED ${toDelete.length} keys with prefix: ${prefix}`);
}

/**
 * Invalida todo o cache de produtos
 */
export function invalidateProducts(): void {
  invalidate(CACHE_KEYS.PRODUCTS_LIST);
  invalidate(CACHE_KEYS.PRODUCTS_FEATURED);
  invalidateByPrefix('product_');
  invalidateByPrefix('products_category_');
}

/**
 * Invalida todo o cache de categorias
 */
export function invalidateCategories(): void {
  invalidate(CACHE_KEYS.CATEGORIES);
}

/**
 * Invalida todo o cache de banners
 */
export function invalidateBanners(): void {
  invalidate(CACHE_KEYS.BANNERS_ACTIVE);
}

/**
 * Limpa todo o cache
 */
export function clearAll(): void {
  cache.flushAll();
  console.log('[Cache] ALL CLEARED');
}

/**
 * Retorna estatisticas do cache
 */
export function getStats() {
  return cache.getStats();
}

export default cache;
