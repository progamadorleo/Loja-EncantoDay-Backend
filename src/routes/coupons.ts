import { Router, Request, Response } from 'express';
import { supabaseAdmin as supabase } from '../config/supabase.js';
import { authMiddleware } from '../middlewares/auth.js';
import { customerAuthMiddleware } from '../middlewares/customerAuth.js';

const router = Router();

// =============================================
// ROTAS ADMIN
// =============================================

// Listar todos os cupons (admin)
router.get('/admin/all', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { status, search, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let query = supabase
      .from('coupons')
      .select('*', { count: 'exact' });

    // Filtros
    if (status === 'active') {
      query = query.eq('is_active', true);
    } else if (status === 'inactive') {
      query = query.eq('is_active', false);
    } else if (status === 'expired') {
      query = query.lt('expires_at', new Date().toISOString());
    }

    if (search) {
      query = query.or(`code.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Ordenacao e paginacao
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit as string) - 1);

    const { data: coupons, error, count } = await query;

    if (error) {
      console.error('Erro ao listar cupons:', error);
      return res.status(500).json({ error: 'Erro ao listar cupons' });
    }

    res.json({
      data: coupons,
      pagination: {
        total: count || 0,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        totalPages: Math.ceil((count || 0) / parseInt(limit as string)),
      }
    });
  } catch (error) {
    console.error('Erro ao listar cupons:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar cupom por ID (admin)
router.get('/admin/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !coupon) {
      return res.status(404).json({ error: 'Cupom nao encontrado' });
    }

    // Buscar estatisticas de uso
    const { count: usageCount } = await supabase
      .from('coupon_usages')
      .select('*', { count: 'exact', head: true })
      .eq('coupon_id', id);

    const { data: totalDiscount } = await supabase
      .from('coupon_usages')
      .select('discount_applied')
      .eq('coupon_id', id);

    const totalDiscountGiven = totalDiscount?.reduce((acc, u) => acc + Number(u.discount_applied), 0) || 0;

    res.json({
      ...coupon,
      stats: {
        totalUses: usageCount || 0,
        totalDiscountGiven,
      }
    });
  } catch (error) {
    console.error('Erro ao buscar cupom:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Criar cupom (admin)
router.post('/admin', authMiddleware, async (req: Request, res: Response) => {
  try {
    const {
      code,
      description,
      discount_type,
      discount_value,
      min_order_value,
      max_discount_value,
      usage_limit,
      usage_per_customer,
      starts_at,
      expires_at,
      is_active,
    } = req.body;

    // Validacoes
    if (!code || !discount_type || !discount_value) {
      return res.status(400).json({ error: 'Codigo, tipo e valor do desconto sao obrigatorios' });
    }

    if (!['percentage', 'fixed'].includes(discount_type)) {
      return res.status(400).json({ error: 'Tipo de desconto invalido' });
    }

    if (discount_type === 'percentage' && (discount_value < 0 || discount_value > 100)) {
      return res.status(400).json({ error: 'Porcentagem deve ser entre 0 e 100' });
    }

    // Verificar se codigo ja existe
    const { data: existing } = await supabase
      .from('coupons')
      .select('id')
      .eq('code', code.toUpperCase())
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Ja existe um cupom com este codigo' });
    }

    const { data: coupon, error } = await supabase
      .from('coupons')
      .insert({
        code: code.toUpperCase(),
        description,
        discount_type,
        discount_value,
        min_order_value: min_order_value || 0,
        max_discount_value,
        usage_limit,
        usage_per_customer: usage_per_customer || 1,
        starts_at: starts_at || new Date().toISOString(),
        expires_at,
        is_active: is_active !== false,
      })
      .select()
      .single();

    if (error) {
      console.error('Erro ao criar cupom:', error);
      return res.status(500).json({ error: 'Erro ao criar cupom' });
    }

    res.status(201).json(coupon);
  } catch (error) {
    console.error('Erro ao criar cupom:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Atualizar cupom (admin)
router.put('/admin/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      code,
      description,
      discount_type,
      discount_value,
      min_order_value,
      max_discount_value,
      usage_limit,
      usage_per_customer,
      starts_at,
      expires_at,
      is_active,
    } = req.body;

    // Verificar se cupom existe
    const { data: existing } = await supabase
      .from('coupons')
      .select('id')
      .eq('id', id)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Cupom nao encontrado' });
    }

    // Verificar se codigo ja existe em outro cupom
    if (code) {
      const { data: codeExists } = await supabase
        .from('coupons')
        .select('id')
        .eq('code', code.toUpperCase())
        .neq('id', id)
        .single();

      if (codeExists) {
        return res.status(400).json({ error: 'Ja existe outro cupom com este codigo' });
      }
    }

    const updateData: any = {};
    if (code) updateData.code = code.toUpperCase();
    if (description !== undefined) updateData.description = description;
    if (discount_type) updateData.discount_type = discount_type;
    if (discount_value !== undefined) updateData.discount_value = discount_value;
    if (min_order_value !== undefined) updateData.min_order_value = min_order_value;
    if (max_discount_value !== undefined) updateData.max_discount_value = max_discount_value;
    if (usage_limit !== undefined) updateData.usage_limit = usage_limit;
    if (usage_per_customer !== undefined) updateData.usage_per_customer = usage_per_customer;
    if (starts_at !== undefined) updateData.starts_at = starts_at;
    if (expires_at !== undefined) updateData.expires_at = expires_at;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: coupon, error } = await supabase
      .from('coupons')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar cupom:', error);
      return res.status(500).json({ error: 'Erro ao atualizar cupom' });
    }

    res.json(coupon);
  } catch (error) {
    console.error('Erro ao atualizar cupom:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Deletar cupom (admin)
router.delete('/admin/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('coupons')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Erro ao deletar cupom:', error);
      return res.status(500).json({ error: 'Erro ao deletar cupom' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao deletar cupom:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Estatisticas de cupons (admin)
router.get('/admin/stats/overview', authMiddleware, async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();

    // Total de cupons
    const { count: totalCoupons } = await supabase
      .from('coupons')
      .select('*', { count: 'exact', head: true });

    // Cupons ativos
    const { count: activeCoupons } = await supabase
      .from('coupons')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${now}`);

    // Total de usos
    const { count: totalUsages } = await supabase
      .from('coupon_usages')
      .select('*', { count: 'exact', head: true });

    // Total de desconto dado
    const { data: discounts } = await supabase
      .from('coupon_usages')
      .select('discount_applied');

    const totalDiscountGiven = discounts?.reduce((acc, u) => acc + Number(u.discount_applied), 0) || 0;

    res.json({
      totalCoupons: totalCoupons || 0,
      activeCoupons: activeCoupons || 0,
      totalUsages: totalUsages || 0,
      totalDiscountGiven,
    });
  } catch (error) {
    console.error('Erro ao buscar estatisticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// =============================================
// ROTAS CLIENTE
// =============================================

// Validar cupom (cliente)
router.post('/validate', customerAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { code, order_total } = req.body;
    const customerId = (req as any).customer?.id;

    if (!code) {
      return res.status(400).json({ error: 'Codigo do cupom e obrigatorio' });
    }

    // Buscar cupom
    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase())
      .eq('is_active', true)
      .single();

    if (error || !coupon) {
      return res.status(404).json({ error: 'Cupom nao encontrado ou inativo' });
    }

    const now = new Date();

    // Verificar data de inicio
    if (coupon.starts_at && new Date(coupon.starts_at) > now) {
      return res.status(400).json({ error: 'Este cupom ainda nao esta valido' });
    }

    // Verificar expiracao
    if (coupon.expires_at && new Date(coupon.expires_at) < now) {
      return res.status(400).json({ error: 'Este cupom expirou' });
    }

    // Verificar limite de uso total
    if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
      return res.status(400).json({ error: 'Este cupom atingiu o limite de usos' });
    }

    // Verificar valor minimo do pedido
    if (order_total && coupon.min_order_value && order_total < coupon.min_order_value) {
      return res.status(400).json({ 
        error: `Valor minimo do pedido: R$ ${coupon.min_order_value.toFixed(2)}` 
      });
    }

    // Verificar uso por cliente
    if (customerId && coupon.usage_per_customer) {
      const { count: customerUsages } = await supabase
        .from('coupon_usages')
        .select('*', { count: 'exact', head: true })
        .eq('coupon_id', coupon.id)
        .eq('customer_id', customerId);

      if (customerUsages && customerUsages >= coupon.usage_per_customer) {
        return res.status(400).json({ error: 'Voce ja utilizou este cupom o maximo de vezes permitido' });
      }
    }

    // Calcular desconto
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = (order_total || 0) * (coupon.discount_value / 100);
      // Aplicar limite maximo se existir
      if (coupon.max_discount_value && discountAmount > coupon.max_discount_value) {
        discountAmount = coupon.max_discount_value;
      }
    } else {
      discountAmount = coupon.discount_value;
    }

    // Nao pode ser maior que o total do pedido
    if (order_total && discountAmount > order_total) {
      discountAmount = order_total;
    }

    res.json({
      valid: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        description: coupon.description,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        max_discount_value: coupon.max_discount_value,
      },
      discount_amount: Math.round(discountAmount * 100) / 100,
    });
  } catch (error) {
    console.error('Erro ao validar cupom:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Aplicar cupom ao pedido (chamado internamente ao criar pedido)
export async function applyCoupon(
  couponCode: string, 
  customerId: string, 
  orderId: string, 
  orderTotal: number
): Promise<{ success: boolean; discount: number; error?: string }> {
  try {
    // Buscar cupom
    const { data: coupon, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', couponCode.toUpperCase())
      .eq('is_active', true)
      .single();

    if (error || !coupon) {
      return { success: false, discount: 0, error: 'Cupom nao encontrado' };
    }

    // Calcular desconto
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = orderTotal * (coupon.discount_value / 100);
      if (coupon.max_discount_value && discountAmount > coupon.max_discount_value) {
        discountAmount = coupon.max_discount_value;
      }
    } else {
      discountAmount = coupon.discount_value;
    }

    if (discountAmount > orderTotal) {
      discountAmount = orderTotal;
    }

    discountAmount = Math.round(discountAmount * 100) / 100;

    // Registrar uso
    await supabase
      .from('coupon_usages')
      .insert({
        coupon_id: coupon.id,
        customer_id: customerId,
        order_id: orderId,
        discount_applied: discountAmount,
      });

    // Incrementar contador de uso
    await supabase
      .from('coupons')
      .update({ usage_count: coupon.usage_count + 1 })
      .eq('id', coupon.id);

    // Atualizar pedido com info do cupom
    await supabase
      .from('orders')
      .update({
        coupon_id: coupon.id,
        coupon_code: coupon.code,
        coupon_discount: discountAmount,
      })
      .eq('id', orderId);

    return { success: true, discount: discountAmount };
  } catch (error) {
    console.error('Erro ao aplicar cupom:', error);
    return { success: false, discount: 0, error: 'Erro ao aplicar cupom' };
  }
}

export default router;
