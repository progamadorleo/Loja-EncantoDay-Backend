import { Router, Request, Response } from 'express';
import { supabaseAdmin as supabase } from '../config/supabase.js';
import { customerAuthMiddleware } from '../middlewares/customerAuth.js';
import { authMiddleware } from '../middlewares/auth.js';
import { MercadoPagoConfig, Payment, Preference } from 'mercadopago';
import { applyCoupon } from './coupons.js';
import { orderLimiter, paymentLimiter } from '../middlewares/rateLimit.js';

const router = Router();

// Configurar Mercado Pago
const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || '',
});

const payment = new Payment(mercadopago);
const preference = new Preference(mercadopago);

// Interface para o corpo da requisicao
interface CreateOrderBody {
  items: Array<{
    product_id: string;
    quantity: number;
    unit_price: number;
    product_name: string;
    product_slug?: string;
    product_image?: string;
  }>;
  shipping_address: {
    street: string;
    number: string;
    complement?: string;
    neighborhood: string;
    city: string;
    state: string;
    zipcode: string;
    recipient_name: string;
  };
  shipping_method: string;
  shipping_price: number;
  shipping_deadline?: string;
  subtotal: number;
  discount?: number;
  total: number;
  coupon_code?: string;
  coupon_discount?: number;
  customer_notes?: string;
}

interface ProcessPaymentBody {
  order_id: string;
  payment_method: 'pix' | 'credit_card';
  // Para cartao de credito
  token?: string;
  installments?: number;
  payment_method_id?: string;
  issuer_id?: number;
  payer_email?: string;
}

// Criar pedido - com rate limiting
router.post('/', orderLimiter, customerAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const customerId = (req as any).customer?.id;
    const body: CreateOrderBody = req.body;

    // Validar dados
    if (!body.items || body.items.length === 0) {
      return res.status(400).json({ error: 'Nenhum item no pedido' });
    }

    if (!body.shipping_address) {
      return res.status(400).json({ error: 'Endereco de entrega obrigatorio' });
    }

    // Gerar referencia externa unica
    const externalReference = `ORDER-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;

    // Criar pedido no banco
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: customerId,
        status: 'pending',
        shipping_address: body.shipping_address,
        shipping_method: body.shipping_method,
        shipping_price: body.shipping_price,
        shipping_deadline: body.shipping_deadline,
        subtotal: body.subtotal,
        discount: body.discount || 0,
        total: body.total,
        coupon_code: body.coupon_code,
        coupon_discount: body.coupon_discount || 0,
        customer_notes: body.customer_notes,
        mp_external_reference: externalReference,
      })
      .select()
      .single();

    if (orderError) {
      console.error('Erro ao criar pedido:', orderError);
      return res.status(500).json({ error: 'Erro ao criar pedido' });
    }

    // Inserir itens do pedido
    const orderItems = body.items.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name: item.product_name,
      product_slug: item.product_slug,
      product_image: item.product_image,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.unit_price * item.quantity,
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('Erro ao inserir itens:', itemsError);
      // Deletar pedido criado em caso de erro
      await supabase.from('orders').delete().eq('id', order.id);
      return res.status(500).json({ error: 'Erro ao inserir itens do pedido' });
    }

    // Registrar uso do cupom (se houver)
    if (body.coupon_code && body.coupon_discount && body.coupon_discount > 0) {
      await applyCoupon(body.coupon_code, customerId, order.id, body.subtotal);
    }

    // Buscar pedido completo com itens
    const { data: fullOrder } = await supabase
      .from('orders')
      .select(`
        *,
        items:order_items(*)
      `)
      .eq('id', order.id)
      .single();

    res.status(201).json(fullOrder);
  } catch (error) {
    console.error('Erro ao criar pedido:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Processar pagamento
router.post('/payment', paymentLimiter, customerAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const customerId = (req as any).customer?.id;
    const body: ProcessPaymentBody = req.body;

    // Buscar pedido
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', body.order_id)
      .eq('customer_id', customerId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Pedido nao encontrado' });
    }

    if (order.payment_status === 'approved') {
      return res.status(400).json({ error: 'Pedido ja foi pago' });
    }

    // Buscar dados do cliente
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    if (body.payment_method === 'pix') {
      // Criar pagamento PIX
      const paymentData = await payment.create({
        body: {
          transaction_amount: Number(order.total),
          description: `Pedido #${order.mp_external_reference}`,
          payment_method_id: 'pix',
          payer: {
            email: customer?.email || body.payer_email || 'cliente@email.com',
          },
          external_reference: order.mp_external_reference,
        }
      });

      // Atualizar pedido com dados do pagamento
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          payment_method: 'pix',
          mp_payment_id: paymentData.id?.toString(),
          payment_status: paymentData.status,
          payment_details: {
            pix_qr_code: paymentData.point_of_interaction?.transaction_data?.qr_code,
            pix_qr_code_base64: paymentData.point_of_interaction?.transaction_data?.qr_code_base64,
            pix_expiration: paymentData.date_of_expiration,
          }
        })
        .eq('id', order.id);

      if (updateError) {
        console.error('Erro ao atualizar pedido:', updateError);
      }

      return res.json({
        payment_id: paymentData.id,
        status: paymentData.status,
        qr_code: paymentData.point_of_interaction?.transaction_data?.qr_code,
        qr_code_base64: paymentData.point_of_interaction?.transaction_data?.qr_code_base64,
        expiration: paymentData.date_of_expiration,
      });

    } else if (body.payment_method === 'credit_card') {
      // Criar pagamento com cartao
      if (!body.token) {
        return res.status(400).json({ error: 'Token do cartao obrigatorio' });
      }

      const paymentData = await payment.create({
        body: {
          transaction_amount: Number(order.total),
          token: body.token,
          description: `Pedido #${order.mp_external_reference}`,
          installments: body.installments || 1,
          payment_method_id: body.payment_method_id,
          issuer_id: body.issuer_id,
          payer: {
            email: customer?.email || body.payer_email || 'cliente@email.com',
          },
          external_reference: order.mp_external_reference,
        }
      });

      // Atualizar pedido com dados do pagamento
      const { error: updateError } = await supabase
        .from('orders')
        .update({
          payment_method: 'credit_card',
          mp_payment_id: paymentData.id?.toString(),
          payment_status: paymentData.status,
          payment_details: {
            card_last_four: paymentData.card?.last_four_digits,
            card_brand: paymentData.card?.cardholder?.name,
            installments: body.installments || 1,
          },
          ...(paymentData.status === 'approved' ? { 
            paid_at: new Date().toISOString(),
            status: 'paid'
          } : {})
        })
        .eq('id', order.id);

      if (updateError) {
        console.error('Erro ao atualizar pedido:', updateError);
      }

      return res.json({
        payment_id: paymentData.id,
        status: paymentData.status,
        status_detail: paymentData.status_detail,
      });
    }

    return res.status(400).json({ error: 'Metodo de pagamento invalido' });
  } catch (error: any) {
    console.error('Erro ao processar pagamento:', error);
    return res.status(500).json({ 
      error: 'Erro ao processar pagamento',
      details: error.message 
    });
  }
});

// Listar pedidos do cliente
router.get('/', customerAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const customerId = (req as any).customer?.id;

    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        *,
        items:order_items(*)
      `)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao listar pedidos:', error);
      return res.status(500).json({ error: 'Erro ao listar pedidos' });
    }

    res.json(orders);
  } catch (error) {
    console.error('Erro ao listar pedidos:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar pedido por ID
router.get('/:id', customerAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const customerId = (req as any).customer?.id;
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        items:order_items(*),
        status_history:order_status_history(*)
      `)
      .eq('id', id)
      .eq('customer_id', customerId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Pedido nao encontrado' });
    }

    res.json(order);
  } catch (error) {
    console.error('Erro ao buscar pedido:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Verificar status do pagamento
router.get('/:id/payment-status', customerAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const customerId = (req as any).customer?.id;
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select('id, payment_status, mp_payment_id, status')
      .eq('id', id)
      .eq('customer_id', customerId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Pedido nao encontrado' });
    }

    // Se tiver payment_id, consultar status atualizado no MP
    if (order.mp_payment_id) {
      try {
        const paymentInfo = await payment.get({ id: order.mp_payment_id });
        
        // Atualizar status se mudou
        if (paymentInfo.status !== order.payment_status) {
          await supabase
            .from('orders')
            .update({
              payment_status: paymentInfo.status,
              ...(paymentInfo.status === 'approved' ? { 
                paid_at: new Date().toISOString(),
                status: 'paid'
              } : {})
            })
            .eq('id', order.id);

          return res.json({
            payment_status: paymentInfo.status,
            order_status: paymentInfo.status === 'approved' ? 'paid' : order.status,
          });
        }
      } catch (mpError) {
        console.error('Erro ao consultar MP:', mpError);
      }
    }

    res.json({
      payment_status: order.payment_status,
      order_status: order.status,
    });
  } catch (error) {
    console.error('Erro ao verificar pagamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// =============================================
// ROTAS ADMIN
// =============================================

// Listar todos os pedidos (admin)
router.get('/admin/all', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { status, payment_status, search, page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    let query = supabase
      .from('orders')
      .select(`
        *,
        items:order_items(*),
        customer:customers(id, name, email, phone)
      `, { count: 'exact' });

    // Filtros
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    if (payment_status && payment_status !== 'all') {
      query = query.eq('payment_status', payment_status);
    }

    if (search) {
      query = query.or(`mp_external_reference.ilike.%${search}%,customer.name.ilike.%${search}%`);
    }

    // Ordenacao e paginacao
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit as string) - 1);

    const { data: orders, error, count } = await query;

    if (error) {
      console.error('Erro ao listar pedidos admin:', error);
      return res.status(500).json({ error: 'Erro ao listar pedidos' });
    }

    res.json({
      data: orders,
      pagination: {
        total: count || 0,
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        totalPages: Math.ceil((count || 0) / parseInt(limit as string)),
      }
    });
  } catch (error) {
    console.error('Erro ao listar pedidos admin:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Buscar pedido por ID (admin)
router.get('/admin/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        *,
        items:order_items(*),
        customer:customers(id, name, email, phone, cpf),
        status_history:order_status_history(*)
      `)
      .eq('id', id)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: 'Pedido nao encontrado' });
    }

    res.json(order);
  } catch (error) {
    console.error('Erro ao buscar pedido admin:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Atualizar status do pedido (admin)
router.patch('/admin/:id/status', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, admin_notes } = req.body;

    const validStatuses = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status invalido' });
    }

    const updateData: any = { status };

    if (admin_notes) {
      updateData.admin_notes = admin_notes;
    }

    // Atualizar campos especificos baseado no status
    if (status === 'shipped') {
      updateData.shipped_at = new Date().toISOString();
    } else if (status === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
    } else if (status === 'paid') {
      updateData.paid_at = new Date().toISOString();
      updateData.payment_status = 'approved';
    }

    const { data: order, error } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao atualizar status:', error);
      return res.status(500).json({ error: 'Erro ao atualizar status' });
    }

    res.json(order);
  } catch (error) {
    console.error('Erro ao atualizar status:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Adicionar codigo de rastreamento (admin)
router.patch('/admin/:id/tracking', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { tracking_code, tracking_url } = req.body;

    const { data: order, error } = await supabase
      .from('orders')
      .update({
        tracking_code,
        tracking_url,
        status: 'shipped',
        shipped_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao adicionar rastreamento:', error);
      return res.status(500).json({ error: 'Erro ao adicionar rastreamento' });
    }

    res.json(order);
  } catch (error) {
    console.error('Erro ao adicionar rastreamento:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Estatisticas de pedidos (admin)
router.get('/admin/stats/overview', authMiddleware, async (req: Request, res: Response) => {
  try {
    // Total de pedidos por status
    const { data: statusCounts } = await supabase
      .from('orders')
      .select('status')
      .then(result => {
        const counts: Record<string, number> = {};
        result.data?.forEach(order => {
          counts[order.status] = (counts[order.status] || 0) + 1;
        });
        return { data: counts };
      });

    // Pedidos de hoje
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { count: todayOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // Faturamento do mes
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    const { data: monthlyOrders } = await supabase
      .from('orders')
      .select('total')
      .eq('status', 'paid')
      .gte('created_at', startOfMonth.toISOString());

    const monthlyRevenue = monthlyOrders?.reduce((acc, order) => acc + Number(order.total), 0) || 0;

    // Pedidos pendentes
    const { count: pendingOrders } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    res.json({
      statusCounts,
      todayOrders: todayOrders || 0,
      monthlyRevenue,
      pendingOrders: pendingOrders || 0,
    });
  } catch (error) {
    console.error('Erro ao buscar estatisticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
