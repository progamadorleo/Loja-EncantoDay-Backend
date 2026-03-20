import { Router, Request, Response } from 'express';
import { supabaseAdmin as supabase } from '../config/supabase.js';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import crypto from 'crypto';

const router = Router();

// Configurar Mercado Pago
const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN || '',
});

const payment = new Payment(mercadopago);

// Webhook do Mercado Pago
router.post('/mercadopago', async (req: Request, res: Response) => {
  try {
    const { type, data, action } = req.body;

    console.log('Webhook MP recebido:', { type, action, data });

    // Verificar assinatura (opcional mas recomendado)
    const xSignature = req.headers['x-signature'] as string;
    const xRequestId = req.headers['x-request-id'] as string;

    if (process.env.MP_WEBHOOK_SECRET && xSignature) {
      const isValid = verifyWebhookSignature(
        req.body,
        xSignature,
        xRequestId,
        process.env.MP_WEBHOOK_SECRET
      );

      if (!isValid) {
        console.error('Assinatura do webhook invalida');
        return res.status(401).json({ error: 'Assinatura invalida' });
      }
    }

    // Processar apenas notificacoes de pagamento
    if (type === 'payment') {
      const paymentId = data.id;

      if (!paymentId) {
        return res.status(400).json({ error: 'Payment ID nao encontrado' });
      }

      // Buscar detalhes do pagamento no MP
      const paymentInfo = await payment.get({ id: paymentId });

      console.log('Detalhes do pagamento:', {
        id: paymentInfo.id,
        status: paymentInfo.status,
        external_reference: paymentInfo.external_reference,
      });

      if (!paymentInfo.external_reference) {
        console.log('Pagamento sem external_reference, ignorando');
        return res.status(200).json({ received: true });
      }

      // Buscar pedido pela referencia externa
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('mp_external_reference', paymentInfo.external_reference)
        .single();

      if (orderError || !order) {
        console.error('Pedido nao encontrado:', paymentInfo.external_reference);
        return res.status(404).json({ error: 'Pedido nao encontrado' });
      }

      // Mapear status do MP para status do pedido
      let orderStatus = order.status;
      const paymentStatus = paymentInfo.status;

      switch (paymentStatus) {
        case 'approved':
          orderStatus = 'paid';
          break;
        case 'rejected':
        case 'cancelled':
          orderStatus = 'cancelled';
          break;
        case 'refunded':
          orderStatus = 'refunded';
          break;
        // pending, in_process, in_mediation - manter status atual
      }

      // Atualizar pedido
      const updateData: any = {
        payment_status: paymentStatus,
        mp_payment_id: paymentId.toString(),
      };

      if (paymentStatus === 'approved') {
        updateData.status = 'paid';
        updateData.paid_at = paymentInfo.date_approved || new Date().toISOString();
        
        // Reduzir estoque dos produtos (apenas se ainda nao foi reduzido)
        if (order.status !== 'paid') {
          await reduceStock(order.id);
        }
      } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
        updateData.status = 'cancelled';
      } else if (paymentStatus === 'refunded') {
        updateData.status = 'refunded';
      }

      // Adicionar detalhes do pagamento
      if (paymentInfo.payment_method_id === 'pix') {
        updateData.payment_details = {
          ...order.payment_details,
          payer_email: paymentInfo.payer?.email,
        };
      } else if (paymentInfo.card) {
        updateData.payment_details = {
          ...order.payment_details,
          card_last_four: paymentInfo.card.last_four_digits,
          card_brand: paymentInfo.payment_method_id,
          installments: paymentInfo.installments,
        };
      }

      const { error: updateError } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', order.id);

      if (updateError) {
        console.error('Erro ao atualizar pedido:', updateError);
        return res.status(500).json({ error: 'Erro ao atualizar pedido' });
      }

      console.log(`Pedido ${order.id} atualizado: ${paymentStatus}`);
    }

    // Sempre retornar 200 para o MP nao reenviar
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Erro no webhook MP:', error);
    // Retornar 200 mesmo com erro para evitar retentativas infinitas
    res.status(200).json({ received: true, error: 'Erro interno' });
  }
});

// Reduzir estoque dos produtos do pedido
async function reduceStock(orderId: string): Promise<void> {
  try {
    // Buscar itens do pedido
    const { data: items, error: itemsError } = await supabase
      .from('order_items')
      .select('product_id, quantity')
      .eq('order_id', orderId);

    if (itemsError || !items || items.length === 0) {
      console.error('Erro ao buscar itens do pedido para reduzir estoque:', itemsError);
      return;
    }

    // Reduzir estoque de cada produto
    for (const item of items) {
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, stock_quantity')
        .eq('id', item.product_id)
        .single();

      if (productError || !product) {
        console.error(`Produto ${item.product_id} nao encontrado para reduzir estoque:`, productError);
        continue;
      }

      const newStock = Math.max(0, (product.stock_quantity || 0) - item.quantity);

      const { error: updateError } = await supabase
        .from('products')
        .update({ stock_quantity: newStock })
        .eq('id', item.product_id);

      if (updateError) {
        console.error(`Erro ao reduzir estoque do produto ${item.product_id}:`, updateError);
      } else {
        console.log(`Estoque do produto ${item.product_id} reduzido: ${product.stock_quantity} -> ${newStock}`);
      }
    }
  } catch (error) {
    console.error('Erro ao reduzir estoque:', error);
  }
}

// Verificar assinatura do webhook
function verifyWebhookSignature(
  body: any,
  xSignature: string,
  xRequestId: string,
  secret: string
): boolean {
  try {
    // Extrair ts e v1 do header x-signature
    const parts = xSignature.split(',');
    let ts = '';
    let hash = '';

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 'ts') ts = value;
      if (key === 'v1') hash = value;
    }

    if (!ts || !hash) return false;

    // Criar string para assinar
    const dataId = body.data?.id || '';
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    // Calcular HMAC
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(manifest)
      .digest('hex');

    return hmac === hash;
  } catch (error) {
    console.error('Erro ao verificar assinatura:', error);
    return false;
  }
}

// Endpoint de teste para verificar se o webhook esta funcionando
router.get('/mercadopago/test', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    message: 'Webhook endpoint funcionando',
    timestamp: new Date().toISOString()
  });
});

export default router;
